import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import {
  getToken,
  setToken,
  parseJWT,
  isTokenValid,
  extractTokenFromHash,
  type JWTClaims,
} from "./lib/auth";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { DevicesPage } from "./pages/DevicesPage";
import { SessionsPage } from "./pages/SessionsPage";
import { ServicesPage } from "./pages/ServicesPage";
import { RelayPage } from "./pages/RelayPage";
import { SystemPage } from "./pages/SystemPage";
import { PairPage } from "./pages/PairPage";

function RequireAuth({ children, claims }: { children: React.ReactNode; claims: JWTClaims | null }) {
  if (!claims) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export function App() {
  const [claims, setClaims] = useState<JWTClaims | null>(null);
  const [checked, setChecked] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Extract token from hash (OAuth callback redirect).
    const hashToken = extractTokenFromHash();
    if (hashToken) {
      setToken(hashToken);
    }

    const stored = getToken();
    if (stored && isTokenValid(stored)) {
      setClaims(parseJWT(stored));
      // If on login page with valid token, redirect to admin.
      if (location.pathname === "/login") {
        navigate("/admin", { replace: true });
      }
    }
    setChecked(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!checked) return null;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/admin"
        element={
          <RequireAuth claims={claims}>
            <Layout claims={claims} />
          </RequireAuth>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="relay" element={<RelayPage />} />
        <Route path="system" element={<SystemPage />} />
        <Route path="pair" element={<PairPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
