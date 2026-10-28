import admin, { getApps } from "firebase-admin";
import dotenv from "dotenv";
import { getAuth } from "firebase-admin/auth";

dotenv.config();

let auth: ReturnType<typeof getAuth>;

try {
    const rawFirebase = process.env.FIREBASE;
    if (!rawFirebase || rawFirebase.trim().length === 0) {
        throw new Error("FIREBASE environment variable is missing or empty.");
    }

    let decoded = "";
    try {
        decoded = Buffer.from(rawFirebase, "base64").toString("utf-8");
    } catch {
        throw new Error("FIREBASE environment variable is not valid Base64.");
    }

    let serviceAccount: admin.ServiceAccount;
    try {
        serviceAccount = JSON.parse(decoded);
    } catch {
        throw new Error("FIREBASE environment variable does not contain valid JSON.");
    }

    const sa = serviceAccount as Record<string, unknown>;
    if (!serviceAccount || typeof serviceAccount !== "object" || (!sa.project_id && !sa.projectId)) {
        throw new Error("FIREBASE service account JSON is missing project_id.");
    }

    const existingApp = getApps().find((app) => app.name === "relay");
    const app = existingApp || admin.initializeApp({ credential: admin.cert(serviceAccount) }, "relay");
    auth = getAuth(app);
} catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Firebase configuration error: ${message}`);
    auth = new Proxy({} as ReturnType<typeof getAuth>, {
        get(_, prop) {
            if (typeof prop === "string") {
                return () => {
                    throw new Error(`Firebase operation failed: ${message}`);
                };
            }
            return undefined;
        },
    });
}

export default auth;
