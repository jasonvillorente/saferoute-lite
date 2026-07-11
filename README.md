# SafeRoute Lite - Capstone Project Documentation

## 1. System Architecture
SafeRoute Lite follows a **Serverless Mobile Web Architecture**:
- **Frontend:** React + Vite + Tailwind CSS (Optimized for mobile viewports).
- **Backend-as-a-Service:** Firebase (Authentication, Firestore Database).
- **Map Engine:** Locked Google Maps Embedded View (Palanan, Makati).
- **State Management:** React Context API (AuthContext).

## 2. Folder Structure
```
/src
  /components     # Reusable UI elements (Layout, Nav)
  /context        # Auth & State providers
  /lib            # Firebase config and utility functions
  /pages          # Main screens (Home, Map, Report, Admin, etc.)
  /types.ts       # TypeScript interfaces for database entities
```

## 3. Database Schema (Firestore)

### `users` (Collection)
| Field | Type | Description |
|-------|------|-------------|
| `name` | String | Full name |
| `email` | String | User email |
| `role` | String | 'resident' or 'admin' |
| `createdAt` | Timestamp | Registration date |

### `reports` (Collection)
| Field | Type | Description |
|-------|------|-------------|
| `reporterId` | String | UID of the reporter |
| `description` | String | Hazard details |
| `status` | String | 'pending', 'approved', 'rejected' |
| `location` | Object | `{ lat, lng }` |
| `createdAt` | Timestamp | Submission time |

### `danger_zones` (Collection)
| Field | Type | Description |
|-------|------|-------------|
| `location` | Object | `{ lat, lng }` |
| `radius` | Number | Influence area in meters |
| `description`| String | Reason for hazard |
| `active` | Boolean | Visibility toggle |

## 4. Safe Route Logic
The application uses a **Visual Context Hub**:
1. **Neighborhood Focus:** The map is locked to Palanan, Makati City, providing high-fidelity visual context for users.
2. **Community Sourcing:** Residents use the map to identify landmarks and coordinates when reporting hazards.
3. **Safety Monitoring:** The administrative suite manages localized alerts and reports relative to the community view.

## 5. Security & Anti-Spam
- **Admin Gate:** Only users with the `admin` role can verify reports into official "Danger Zones".
- **Authentication:** Only registered residents can submit reports.
- **Rules:** Firestore Security Rules prevent residents from approving their own reports or modifying other users' profiles.

## 6. Implementation Checklist
- [x] Integrated Google Maps Iframe (Palanan View).
- [ ] **Enable Email/Password Auth:** 
  1. Go to [Firebase Console](https://console.firebase.google.com/).
  2. Select your project.
  3. Click **Authentication** > **Sign-in method**.
  4. Click **Add new provider** > **Email/Password**.
  5. Enable it and click **Save**.
- [ ] Deploy Firestore Rules using the provided `firestore.rules`.
