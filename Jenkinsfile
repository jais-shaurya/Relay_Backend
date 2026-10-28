    pipeline {
    agent any

    stages {

        stage('Checkout') {
            steps {
                git branch: "${params.BRANCH}",
                    url: "${params.REPO_URL}"
            }
        }

        stage('Create Dockerfile') {
            steps {
                writeFile(
                    file: 'Dockerfile',
                    text: params.DOCKERFILE_CONTENT
                )
            }
        }

        stage('Build Docker Image') {
            steps {
                sh """
                    docker build \
                        -t ${params.IMAGE_NAME}:${params.IMAGE_TAG} \
                        .
                """
            }
        }

        stage('Push Docker Image') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'dockerhub',
                        usernameVariable: 'DOCKER_USERNAME',
                        passwordVariable: 'DOCKER_PASSWORD'
                    )
                ]) {
                    sh '''
                        echo "$DOCKER_PASSWORD" | docker login \
                            -u "$DOCKER_USERNAME" \
                            --password-stdin

                        docker push "$IMAGE_NAME:$IMAGE_TAG"

                        docker logout
                    '''
                }
            }
        }
    }
}