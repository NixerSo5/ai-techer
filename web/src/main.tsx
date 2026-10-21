import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import Layout from './Layout';
import SettingsPage from './pages/SettingsPage';
import CoursesPage from './pages/CoursesPage';
import CreateCoursePage from './pages/CreateCoursePage';
import OutlineConfirmPage from './pages/OutlineConfirmPage';
import PathPage from './pages/PathPage';
import TutorPage from './pages/TutorPage';
import './styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <CoursesPage /> },
      { path: 'new', element: <CreateCoursePage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'courses/:courseId/outline', element: <OutlineConfirmPage /> },
      { path: 'paths/:pathId', element: <PathPage /> },
      { path: 'tutor/:pathId/:nodeId', element: <TutorPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
