import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Tasks from './pages/Tasks';
import Activities from './pages/Activities';
import { TRPCProvider } from './TRPCProvider';

function AppContent() {
  return (
    <>
      <nav style={{ padding: '10px', borderBottom: '1px solid #ccc', marginBottom: '20px' }}>
        <Link to="/" style={{ marginRight: '20px' }}>
          Tasks
        </Link>
        <Link to="/activities">Log Activity</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Tasks />} />
        <Route path="/activities" element={<Activities />} />
      </Routes>
    </>
  );
}

function App() {
  return (
    <TRPCProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </TRPCProvider>
  );
}

export default App;
