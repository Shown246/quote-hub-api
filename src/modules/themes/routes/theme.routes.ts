import { Router } from "express";
import { themeController } from "../controllers/theme.controller";

export const themeRouter = Router();

themeRouter.get("/", themeController.list);
