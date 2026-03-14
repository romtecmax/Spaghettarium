import { NavLink } from "react-router";

const links = [
  { to: "/library", label: "Library" },
  { to: "/analytics", label: "Analytics" },
];

export function Nav() {
  return (
    <nav className="flex items-center gap-6 px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
      <NavLink to="/" className="font-bold text-lg tracking-tight mr-4">
        Spaghettarium
      </NavLink>
      {links.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            isActive
              ? "text-blue-600 dark:text-blue-400 font-medium"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}