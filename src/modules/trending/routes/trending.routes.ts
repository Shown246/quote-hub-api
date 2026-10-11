import { Router } from "express";
import { trendingController } from "../controllers/trending.controller";

export const trendingRouter = Router();

trendingRouter.get("/", trendingController.getTrending);
