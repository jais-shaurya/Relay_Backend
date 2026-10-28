import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { JenkinsService } from '../dist/services/jenkins.js';

describe('Jenkins Build Tracking & Status Suite', () => {
  let jenkins: JenkinsService;
  let originalEnv: NodeJS.ProcessEnv;
  let originalAxiosGet: typeof axios.get;
  let originalAxiosPost: typeof axios.post;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.JENKINS_USER = 'test-user';
    process.env.JENKINS_API_TOKEN = 'test-token';
    process.env.JENKINS_URL = 'http://localhost:8090';

    jenkins = new JenkinsService();
    originalAxiosGet = axios.get;
    originalAxiosPost = axios.post;
  });

  afterEach(() => {
    process.env = originalEnv;
    axios.get = originalAxiosGet;
    axios.post = originalAxiosPost;
  });

  describe('1. Queue URL Normalization and ID Extraction', () => {
    test('normalizes internal container host and port to configured baseUrl', () => {
      const normalized = jenkins.normalizeQueueUrl('http://localhost:8080/queue/item/42/');
      assert.equal(normalized, 'http://localhost:8090/queue/item/42/');
    });

    test('normalizes docker internal hostname and path to configured baseUrl', () => {
      const normalized = jenkins.normalizeQueueUrl('http://jenkins-internal:8080/ci/queue/item/99/');
      assert.equal(normalized, 'http://localhost:8090/queue/item/99/');
    });

    test('normalizes relative path with leading slash', () => {
      const normalized = jenkins.normalizeQueueUrl('/queue/item/101/');
      assert.equal(normalized, 'http://localhost:8090/queue/item/101/');
    });

    test('normalizes relative path without leading slash', () => {
      const normalized = jenkins.normalizeQueueUrl('queue/item/102/');
      assert.equal(normalized, 'http://localhost:8090/queue/item/102/');
    });

    test('extracts queueId correctly from various queue URL formats', () => {
      assert.equal(jenkins.getQueueId('http://localhost:8080/queue/item/42/'), 42);
      assert.equal(jenkins.getQueueId('http://172.17.0.2:8080/queue/item/789'), 789);
      assert.equal(jenkins.getQueueId('/queue/item/1000/'), 1000);
      assert.equal(jenkins.getQueueId('invalid-url'), null);
    });

    test('triggerBuild returns a normalized queueUrl matching configured baseUrl', async () => {
      axios.post = (async (url: string) => {
        assert.equal(url, 'http://localhost:8090/job/relay-builder/buildWithParameters');
        return {
          status: 201,
          headers: {
            location: 'http://localhost:8080/queue/item/55/',
          },
        };
      }) as unknown as typeof axios.post;

      const queueUrl = await jenkins.triggerBuild({
        repoUrl: 'https://github.com/example/repo',
        branch: 'main',
        dockerfileContent: 'FROM node:20',
        imageName: 'my-app',
        imageTag: 'v1',
      });

      assert.equal(queueUrl, 'http://localhost:8090/queue/item/55/');
    });
  });

  describe('2. Queue to Build Number Resolution', () => {
    test('extracts build number when executable.number is an integer', async () => {
      axios.get = (async (url: string) => {
        assert.equal(url, 'http://localhost:8090/queue/item/42/api/json');
        return {
          data: {
            id: 42,
            executable: {
              number: 12,
              url: 'http://localhost:8080/job/relay-builder/12/',
            },
          },
        };
      }) as unknown as typeof axios.get;

      // Pass raw queue URL with mismatching port to verify normalization
      const buildNumber = await jenkins.getBuildNumberFromQueue(
        'http://localhost:8080/queue/item/42/',
        1
      );
      assert.equal(buildNumber, 12);
    });

    test('extracts build number when executable.number is a numeric string', async () => {
      axios.get = (async () => {
        return {
          data: {
            id: 42,
            executable: {
              number: '15',
            },
          },
        };
      }) as unknown as typeof axios.get;

      const buildNumber = await jenkins.getBuildNumberFromQueue(
        'http://localhost:8090/queue/item/42/',
        1
      );
      assert.equal(buildNumber, 15);
    });

    test('extracts build number from executable.url when number is absent', async () => {
      axios.get = (async () => {
        return {
          data: {
            id: 42,
            executable: {
              url: 'http://localhost:8090/job/relay-builder/77/',
            },
          },
        };
      }) as unknown as typeof axios.get;

      const buildNumber = await jenkins.getBuildNumberFromQueue(
        '/queue/item/42/',
        1
      );
      assert.equal(buildNumber, 77);
    });

    test('falls back to job builds list when queue item returns 404 (item purged after completion)', async () => {
      axios.get = (async (url: string) => {
        if (url.includes('/queue/item/42/api/json')) {
          const notFoundError = new Error('Not Found') as Error & { response?: { status: number } };
          notFoundError.response = { status: 404 };
          throw notFoundError;
        }
        if (url.includes('/job/relay-builder/api/json')) {
          return {
            data: {
              builds: [
                { number: 88, queueId: 43 },
                { number: 87, queueId: 42 },
                { number: 86, queueId: 40 },
              ],
            },
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      }) as unknown as typeof axios.get;

      const buildNumber = await jenkins.getBuildNumberFromQueue(
        'http://localhost:8080/queue/item/42/',
        1
      );
      assert.equal(buildNumber, 87);
    });

    test('falls back to job builds list when queue item is still waiting with null executable but build registered', async () => {
      let queueCalls = 0;
      axios.get = (async (url: string) => {
        if (url.includes('/queue/item/42/api/json')) {
          queueCalls++;
          return {
            data: {
              id: 42,
              blocked: false,
              buildable: true,
              executable: null,
            },
          };
        }
        if (url.includes('/job/relay-builder/api/json')) {
          return {
            data: {
              builds: [
                { number: 93, queueId: 42 },
              ],
            },
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      }) as unknown as typeof axios.get;

      const buildNumber = await jenkins.getBuildNumberFromQueue(
        'http://localhost:8090/queue/item/42/',
        1
      );
      assert.equal(buildNumber, 93);
      assert.equal(queueCalls, 1);
    });

    test('throws cancelled error when queue reports build was cancelled', async () => {
      axios.get = (async () => {
        return {
          data: {
            id: 42,
            cancelled: true,
            executable: null,
          },
        };
      }) as unknown as typeof axios.get;

      await assert.rejects(
        async () => {
          await jenkins.getBuildNumberFromQueue('http://localhost:8090/queue/item/42/', 1);
        },
        {
          name: 'Error',
          message: 'Jenkins build was cancelled in queue',
        }
      );
    });

    test('rethrows 404 when queue item is 404 and no build with queueId exists in job builds', async () => {
      axios.get = (async (url: string) => {
        if (url.includes('/queue/item/42/api/json')) {
          const err = new Error('Not Found') as Error & { response?: { status: number } };
          err.response = { status: 404 };
          throw err;
        }
        if (url.includes('/job/relay-builder/api/json')) {
          return {
            data: {
              builds: [{ number: 1, queueId: 999 }],
            },
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      }) as unknown as typeof axios.get;

      await assert.rejects(
        async () => {
          await jenkins.getBuildNumberFromQueue('http://localhost:8090/queue/item/42/', 1);
        },
        (err: unknown) => {
          return typeof err === 'object' && err !== null && 'response' in err && (err as { response?: { status?: unknown } }).response?.status === 404;
        }
      );
    });

    test('times out when build does not start within maxAttempts and is not in job builds', async () => {
      axios.get = (async (url: string) => {
        if (url.includes('/queue/item/42/api/json')) {
          return {
            data: {
              id: 42,
              executable: null,
            },
          };
        }
        if (url.includes('/job/relay-builder/api/json')) {
          return {
            data: {
              builds: [],
            },
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      }) as unknown as typeof axios.get;

      await assert.rejects(
        async () => {
          await jenkins.getBuildNumberFromQueue('http://localhost:8090/queue/item/42/', 1);
        },
        {
          name: 'Error',
          message: 'Timed out waiting for Jenkins build to start',
        }
      );
    });
  });

  describe('3. Build Status & Progressive Logs', () => {
    test('reports BUILDING when Jenkins building is true', async () => {
      axios.get = (async (url: string) => {
        assert.equal(url, 'http://localhost:8090/job/relay-builder/42/api/json');
        return {
          data: {
            building: true,
            result: null,
          },
        };
      }) as unknown as typeof axios.get;

      const status = await jenkins.getBuildStatus(42);
      assert.equal(status, 'BUILDING');
    });

    test('reports SUCCESS when build succeeds', async () => {
      axios.get = (async () => {
        return {
          data: {
            building: false,
            result: 'SUCCESS',
          },
        };
      }) as unknown as typeof axios.get;

      const status = await jenkins.getBuildStatus(42);
      assert.equal(status, 'SUCCESS');
    });

    test('reports FAILURE when build fails', async () => {
      axios.get = (async () => {
        return {
          data: {
            building: false,
            result: 'FAILURE',
          },
        };
      }) as unknown as typeof axios.get;

      const status = await jenkins.getBuildStatus(42);
      assert.equal(status, 'FAILURE');
    });

    test('fetches progressive text logs with offset and more-data flag', async () => {
      axios.get = (async (url: string) => {
        assert.equal(url, 'http://localhost:8090/job/relay-builder/42/logText/progressiveText?start=100');
        return {
          data: 'Docker build step completed successfully\n',
          headers: {
            'x-text-size': '250',
            'x-more-data': 'false',
          },
        };
      }) as unknown as typeof axios.get;

      const logs = await jenkins.getProgressiveLog(42, 100);
      assert.equal(logs.text, 'Docker build step completed successfully\n');
      assert.equal(logs.nextOffset, 250);
      assert.equal(logs.hasMore, false);
    });
  });

  describe('4. Polling Errors & Failure Status Mapping', () => {
    test('distinguishes between queued (in progress) vs cancelled vs failed build states', async () => {
      // 1. In queue, executable not ready yet -> BUILDING
      axios.get = (async (url: string) => {
        if (url.includes('/queue/item/10/api/json')) {
          return {
            data: { id: 10, executable: null },
          };
        }
        if (url.includes('/job/relay-builder/api/json')) {
          return { data: { builds: [] } };
        }
        throw new Error('Not found');
      }) as unknown as typeof axios.get;

      await assert.rejects(
        () => jenkins.getBuildNumberFromQueue('http://localhost:8090/queue/item/10/', 1),
        /Timed out waiting for Jenkins build to start/
      );

      // 2. Terminal failure reported by buildStatus
      axios.get = (async () => ({
        data: { building: false, result: 'FAILURE' },
      })) as unknown as typeof axios.get;
      const failStatus = await jenkins.getBuildStatus(10);
      assert.equal(failStatus, 'FAILURE');

      // 3. Aborted status reported by buildStatus
      axios.get = (async () => ({
        data: { building: false, result: 'ABORTED' },
      })) as unknown as typeof axios.get;
      const abortStatus = await jenkins.getBuildStatus(10);
      assert.equal(abortStatus, 'ABORTED');

      // 4. Unstable status reported by buildStatus
      axios.get = (async () => ({
        data: { building: false, result: 'UNSTABLE' },
      })) as unknown as typeof axios.get;
      const unstableStatus = await jenkins.getBuildStatus(10);
      assert.equal(unstableStatus, 'UNSTABLE');
    });

    test('recovers build number seamlessly when Jenkins has already pushed Docker image and left the queue', async () => {
      // Step A: Queue endpoint returns 404 because Jenkins finished the build quickly and pushed the image
      // Step B: Query to /job/relay-builder/api/json successfully links queueId -> buildNumber
      // Step C: Query to /job/relay-builder/{buildNumber}/api/json returns SUCCESS
      axios.get = (async (url: string) => {
        if (url.includes('/queue/item/200/api/json')) {
          const err = new Error('Queue item expired') as Error & { response?: { status: number } };
          err.response = { status: 404 };
          throw err;
        }
        if (url.includes('/job/relay-builder/api/json')) {
          return {
            data: {
              builds: [
                { number: 45, queueId: 200 },
              ],
            },
          };
        }
        if (url.includes('/job/relay-builder/45/api/json')) {
          return {
            data: {
              building: false,
              result: 'SUCCESS',
            },
          };
        }
        throw new Error(`Unexpected endpoint: ${url}`);
      }) as unknown as typeof axios.get;

      const buildNumber = await jenkins.getBuildNumberFromQueue(
        'http://localhost:8080/queue/item/200/',
        1
      );
      assert.equal(buildNumber, 45);

      const status = await jenkins.getBuildStatus(buildNumber);
      assert.equal(status, 'SUCCESS');
    });
  });
});
