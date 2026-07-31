import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import ProductPage from './pages/ProductPage';
import CartPage from './pages/CartPage';
import CheckoutPage from './pages/CheckoutPage';
import OrderSuccessPage from './pages/OrderSuccessPage';
import OrdersPage from './pages/OrdersPage';
import LoginPage from './pages/LoginPage';
import AccountPage from './pages/AccountPage';
import AdminLayout from './pages/admin/AdminLayout';
import AdminLoginPage from './pages/admin/AdminLoginPage';
import AdminOverviewPage from './pages/admin/AdminOverviewPage';
import AdminProfilesPage from './pages/admin/AdminProfilesPage';
import AdminProfileDetailPage from './pages/admin/AdminProfileDetailPage';
import AdminLivePage from './pages/admin/AdminLivePage';
import AdminBotsPage from './pages/admin/AdminBotsPage';
import AdminBotDetailPage from './pages/admin/AdminBotDetailPage';
import AdminActiveBotsPage from './pages/admin/AdminActiveBotsPage';
import AdminAiPage from './pages/admin/AdminAiPage';
import AdminInsightsPage from './pages/admin/AdminInsightsPage';
import AdminRealtimeAnalysisPage from './pages/admin/AdminRealtimeAnalysisPage';
import AdminPersonaAnalysisPage from './pages/admin/AdminPersonaAnalysisPage';
import AdminBuyerBehaviorPage from './pages/admin/AdminBuyerBehaviorPage';
import AdminPredictionsPage from './pages/admin/AdminPredictionsPage';
import AdminKnowledgePage from './pages/admin/AdminKnowledgePage';
import AdminChatPage from './pages/admin/AdminChatPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Consumer behavior AI console */}
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminOverviewPage />} />
        <Route path="bots/active" element={<AdminActiveBotsPage />} />
        <Route path="bots" element={<AdminBotsPage />} />
        <Route path="bots/:id" element={<AdminBotDetailPage />} />
        <Route path="buyers" element={<AdminBuyerBehaviorPage />} />
        <Route path="knowledge" element={<AdminKnowledgePage />} />
        <Route path="chat" element={<AdminChatPage />} />
        <Route path="predictions" element={<AdminPredictionsPage />} />
        <Route path="analysis" element={<AdminRealtimeAnalysisPage />} />
        <Route path="personas" element={<AdminPersonaAnalysisPage />} />
        <Route path="ai" element={<AdminAiPage />} />
        <Route path="insights" element={<AdminInsightsPage />} />
        <Route path="profiles" element={<AdminProfilesPage />} />
        <Route path="profiles/:key" element={<AdminProfileDetailPage />} />
        <Route path="live" element={<AdminLivePage />} />
      </Route>

      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="s" element={<SearchPage />} />
        <Route path="product/:id" element={<ProductPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="order/:orderId" element={<OrderSuccessPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
