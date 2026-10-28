import type { Request, Response, NextFunction } from "express";

import express from "express"
import cors from "cors";
import dotenv from "dotenv"

import {verifyFirebaseToken} from "./middleware/firebase.js";
import { verifyApiKey } from "./middleware/api.js";

import apiRoutes from "./routes/api.routes.js";

dotenv.config();

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV;

const app = express();

app.use(cors());
app.use(express.json());

app.use(verifyApiKey);
app.use('/api/v1', apiRoutes);



//Test Route
app.get('/health', verifyApiKey, (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', message: 'API is healthy' });
});

app.get('/secured/user', verifyApiKey, verifyFirebaseToken, (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', message: 'Secured API is healthy' });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  const requestError = err as Error & { type?: string };
  if (requestError.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON request body.' });
  }

  console.error('Unhandled request error:', err.name);
  res.status(500).json({ message: 'An unexpected error occurred.' });
});

//Global Route handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ message: 'Route not found' });
});

function main(){
    app.listen(PORT, () => {
        console.log(`Server started at http://localhost:${PORT}`);
    })
}

if(NODE_ENV == "dev") main();
export default app;
