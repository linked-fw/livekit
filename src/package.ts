import { linkedPackage } from '@_linked/core/utils/Package';

export const liveKitPackageName = '@_linked/livekit' as const;
const registration = linkedPackage(liveKitPackageName);
export const { getPackageShape, linkedOntology, linkedShape, linkedUtil,
  packageExports, packageMetadata, registerPackageExport, registerPackageModule } = registration;
export const packageName = registration.packageName;
