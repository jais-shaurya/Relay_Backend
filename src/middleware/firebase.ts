import type { Request, Response, NextFunction } from 'express';
import type { FirebaseError } from 'firebase-admin';

import auth from "../config/firebase.js"
import type { DecodedIdToken } from 'firebase-admin/auth';

export const verifyFirebaseToken = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if(!authHeader?.startsWith("Bearer ")) return res.status(401).json({error: "unauthorized", message: "Authorization token missing or invalid"});

    const token = authHeader.split(' ')[1];
    if(!token) return res.status(401).json({ error: 'unauthorized', message: 'Authorization token missing or invalid'});

    try{
        const decodedToken: DecodedIdToken = await auth.verifyIdToken(token, true);

        if (!decodedToken.email || !decodedToken.name) {
            return res.status(401).json({
                error: 'unauthorized',
                message: 'Your Firebase account must have an email and name.',
            });
        }

        req.firebaseUser = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            name: decodedToken.name,
        };

        next();
    }
    catch (err: any) {
        const error: FirebaseError = err;
        console.error('Firebase token verification failed:', error.code);

        let message = 'Unauthorized access';
        if (error.code === 'auth/id-token-expired') {
            message = 'Token expired. Please log in again.';
        } else if (error.code === 'auth/argument-error') {
            message = 'Invalid token format.';
        }

        return res.status(401).json({ error: 'unauthorized', message });
    }
};
