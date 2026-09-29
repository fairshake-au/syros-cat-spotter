import { Router, type IRouter } from "express";
import healthRouter from "./health";
import catsRouter from "./cats";
import photosRouter from "./photos";
import sightingsRouter from "./sightings";
import profilesRouter from "./profiles";
import notificationsRouter from "./notifications";
import campaignRouter from "./campaign";
import internalRouter from "./internal";

const router: IRouter = Router();

router.use(healthRouter);
router.use(catsRouter);
router.use(photosRouter);
router.use(sightingsRouter);
router.use(profilesRouter);
router.use(notificationsRouter);
router.use(campaignRouter);
router.use(internalRouter);

export default router;
