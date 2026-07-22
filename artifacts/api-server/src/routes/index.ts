import { Router, type IRouter } from "express";
import healthRouter from "./health";
import catsRouter from "./cats";
import photosRouter from "./photos";
import sightingsRouter from "./sightings";
import profilesRouter from "./profiles";
import notificationsRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(catsRouter);
router.use(photosRouter);
router.use(sightingsRouter);
router.use(profilesRouter);
router.use(notificationsRouter);

export default router;
