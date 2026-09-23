import type { Request, Response, NextFunction } from 'express';
import type { FirebaseError } from 'firebase-admin';

import auth from "../config/firebase.js"

export const verifyFirebaseToken = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if(!authHeader?.startsWith("Bearer ")) return res.status(401).json({error: "unauthorized", message: "Authorization token missing or invalid"});

    const token = authHeader.split(' ')[1];
    if(!token) return res.status(401).json({ error: 'unauthorized', message: 'Authorization token missing or invalid'});

    try{
        const decodedToken = await auth.verifyIdToken(token, true);

        console.log(decodedToken);

        next();
    }
    catch (err: any) {
        const error: FirebaseError = err;
        console.error('Error verifying token:', error.code, error.message);

        let message = 'Unauthorized access';
        if (error.code === 'auth/id-token-expired') {
            message = 'Token expired. Please log in again.';
        } else if (error.code === 'auth/argument-error') {
            message = 'Invalid token format.';
        }

        return res.status(401).json({ error: 'unauthorized', message });
    }
};