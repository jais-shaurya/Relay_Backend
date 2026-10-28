import type { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.API_KEY;

export const verifyApiKey = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key']

    if (!apiKey || apiKey !== API_KEY)
        return res.status(403).json({error:'Forbidden', message: 'Invalid API Key' });

    next();
}
