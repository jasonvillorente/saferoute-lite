/**
 * SafeRoute Lite - Demo Mode Configuration
 *
 * When DEMO_MODE is true:
 * - Users can explore all frontend features: Map, Routes, Danger Zones, Community Spots,
 *   and real-time GPS Location detection ("Pin Location").
 * - Data-modifying operations (such as creating danger reports, adding community spots,
 *   or logging SOS alerts to Firebase) are blocked to protect the production database
 *   from false or test data during thesis presentations and demonstrations.
 *
 * Set to false when deploying the application for live, real-world reporting.
 */
export const DEMO_MODE = true;
