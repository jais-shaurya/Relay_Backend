import admin, {getApps} from "firebase-admin"
import dotenv from "dotenv";
import { getAuth } from "firebase-admin/auth";

dotenv.config();

const FIREBASE = process.env.FIREBASE || "";

const serviceAccount = JSON.parse(
    Buffer.from(FIREBASE, "base64").toString("utf-8")
);

try {
    if (!getApps().length) {
        admin.initializeApp({credential: admin.cert(serviceAccount)}, "relay");
    }

} catch (error) {
    console.error("Error initializing Firebase:", error);
    process.exit(1);
}

const auth = getAuth(admin.getApp("relay"))
export default auth;