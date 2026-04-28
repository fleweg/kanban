import { Component } from "react";
import { Loader2 } from "lucide-react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppDataProvider } from "./context/AppDataContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { AppLayout } from "./components/layout/AppLayout";
import { BacklogPage } from "./pages/BacklogPage";
import { ActiveSprintPage } from "./pages/ActiveSprintPage";
import { SprintsPage } from "./pages/SprintsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UsersPage } from "./pages/UsersPage";
import { LoginPage } from "./pages/LoginPage";
import { ErrorScreen } from "./components/ErrorScreen";
import { getAdminEmail, getMissingFirebaseEnvVars } from "./services/firebase";

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("App error:", error, info);
  }
  render() {
    if (this.state.error) {
      return <ErrorScreen title="Application error" message={this.state.error.message} />;
    }
    return this.props.children;
  }
}

function FullScreenSpinner() {
  return (
    <div className="min-h-full flex items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-surface-400" />
    </div>
  );
}

function RequireAdmin({ children }) {
  const { isAdmin } = useAuth();
  return isAdmin ? children : <Navigate to="/sprint" replace />;
}

function AuthenticatedShell() {
  const { user, loading, disabled, error } = useAuth();

  if (loading) return <FullScreenSpinner />;

  if (!user) return <LoginPage />;

  if (error) {
    return (
      <ErrorScreen
        title="Could not load your account"
        message={`${error.message}\n\nIf the problem persists, sign out and try again.`}
      />
    );
  }

  if (disabled) {
    return (
      <ErrorScreen
        title="Account disabled"
        message={"Your access to this Kanban has been disabled. Contact your administrator."}
      />
    );
  }

  return (
    <AppDataProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/sprint" replace />} />
          <Route path="/sprint" element={<ActiveSprintPage />} />
          <Route path="/backlog" element={<BacklogPage />} />
          <Route path="/sprints" element={<SprintsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route
            path="/users"
            element={
              <RequireAdmin>
                <UsersPage />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<Navigate to="/sprint" replace />} />
        </Route>
      </Routes>
    </AppDataProvider>
  );
}

export default function App() {
  const missing = getMissingFirebaseEnvVars();
  if (missing.length > 0) {
    return (
      <ErrorScreen
        title="Firebase is not configured"
        message={`The following env variables are missing:\n${missing.join("\n")}\n\nCopy .env.example to .env, fill in your Firebase project credentials, and restart the dev server.`}
      />
    );
  }

  if (!getAdminEmail()) {
    return (
      <ErrorScreen
        title="Admin email is not configured"
        message={"VITE_ADMIN_EMAIL is missing in .env. Set it to the email of the bootstrap administrator."}
      />
    );
  }

  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <AuthenticatedShell />
        </AuthProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
