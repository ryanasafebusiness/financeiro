import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import AppLayout from "@/components/layout/AppLayout";

import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Transacoes from "@/pages/Transacoes";
import Categorias from "@/pages/Categorias";
import Recorrentes from "@/pages/Recorrentes";
import Metas from "@/pages/Metas";
import Limites from "@/pages/Limites";
import Relatorios from "@/pages/Relatorios";
import Assinatura from "@/pages/Assinatura";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminUsuarios from "@/pages/admin/AdminUsuarios";
import AdminConversas from "@/pages/admin/AdminConversas";
import AdminPagamentos from "@/pages/admin/AdminPagamentos";
import AdminPrompt from "@/pages/admin/AdminPrompt";
import AdminPlanos from "@/pages/admin/AdminPlanos";
import AdminConfiguracoes from "@/pages/admin/AdminConfiguracoes";
import AdminIntegracoes from "@/pages/admin/AdminIntegracoes";
import NotFound from "@/pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/transacoes" element={<Transacoes />} />
        <Route path="/recorrentes" element={<Recorrentes />} />
        <Route path="/categorias" element={<Categorias />} />
        <Route path="/metas" element={<Metas />} />
        <Route path="/limites" element={<Limites />} />
        <Route path="/relatorios" element={<Relatorios />} />
        <Route path="/assinatura" element={<Assinatura />} />
        <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
        <Route path="/admin/usuarios" element={<AdminRoute><AdminUsuarios /></AdminRoute>} />
        <Route path="/admin/conversas" element={<AdminRoute><AdminConversas /></AdminRoute>} />
        <Route path="/admin/pagamentos" element={<AdminRoute><AdminPagamentos /></AdminRoute>} />
        <Route path="/admin/prompt" element={<AdminRoute><AdminPrompt /></AdminRoute>} />
        <Route path="/admin/planos" element={<AdminRoute><AdminPlanos /></AdminRoute>} />
        <Route path="/admin/configuracoes" element={<AdminRoute><AdminConfiguracoes /></AdminRoute>} />
        <Route path="/admin/integracoes" element={<AdminRoute><AdminIntegracoes /></AdminRoute>} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
