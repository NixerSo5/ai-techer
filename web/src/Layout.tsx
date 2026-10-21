import { NavLink, Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">AI Teacher</span>
        <nav>
          <NavLink to="/" end>
            我的课程
          </NavLink>
          <NavLink to="/new">建课</NavLink>
          <NavLink to="/settings">设置</NavLink>
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
