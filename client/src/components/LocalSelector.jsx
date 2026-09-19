import { useAuth } from '../auth/AuthContext.jsx';

export default function LocalSelector() {
  const { user, locals, currentLocalId, switchLocal } = useAuth();

  // Only show for district admin
  if (!user || user.role !== 'district_admin') {
    return null;
  }

  if (locals.length === 0) {
    return null;
  }

  const currentLocal = locals.find((b) => b.id === currentLocalId);

  return (
    <div className="local-selector">
      <label htmlFor="local-select" className="local-selector-label">
        Local:
      </label>
      <select
        id="local-select"
        className="input local-selector-select"
        value={currentLocalId || ''}
        onChange={(e) => switchLocal(Number(e.target.value) || null)}
      >
        <option value="">All Locals</option>
        {locals.map((local) => (
          <option key={local.id} value={local.id}>
            {local.name}
          </option>
        ))}
      </select>
      {currentLocal && (
        <span className="local-selector-current small muted">
          Viewing: {currentLocal.name}
        </span>
      )}
    </div>
  );
}
