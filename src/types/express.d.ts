import 'express'
import type { FirebaseAccount } from '../validation/auth.schema.ts';


declare global {
    namespace Express {
        export interface Request {
            firebaseUser?: FirebaseAccount;
        }
    }
}