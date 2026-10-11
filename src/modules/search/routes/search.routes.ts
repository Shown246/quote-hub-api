import { Router } from "express";
import { searchController } from "../controllers/search.controller";
import { searchRateLimiter } from "../../../middleware/rate-limit";

export const searchRouter = Router();

searchRouter.get("/", searchRateLimiter, searchController.search);

