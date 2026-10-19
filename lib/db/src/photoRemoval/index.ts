// SYC-462: removing a photo for good. The one implementation, for the photos
// command today and SYC-246's team button in November.
export { removePhoto, type RemovalPlan, type RemoveInput, type RemoveResult, type RemoveRefusal } from "./remove";
export { hidePhotoForPrivacy, restorePhoto, type HideResult, type RestoreResult } from "./hide";
export { listCatPhotos, type ListedPhoto } from "./list";
export { photoState, isTeamMemberNow, type PhotoState } from "./eligibility";
export { standInFor } from "./standIn";
export { PHOTO_REF_RE, isPhotoRef } from "./rules";
