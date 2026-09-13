import { useAuth } from '../../auth/AuthContext.jsx';

export default function BranchSelector() {
  const { user, branches, currentBranchId, switchBranch } = useAuth();

  // Only show for district admin
  if (!user || user.role !== 'district_admin') {
    return null;
  }

  if (branches.length === 0) {
    return null;
  }

  const currentBranch = branches.find((b) => b.id === currentBranchId);

  return (
    <div className="branch-selector">
      <label htmlFor="branch-select" className="branch-selector-label">
        Branch:
      </label>
      <select
        id="branch-select"
        className="input branch-selector-select"
        value={currentBranchId || ''}
        onChange={(e) => switchBranch(Number(e.target.value) || null)}
      >
        <option value="">All Branches</option>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
      {currentBranch && (
        <span className="branch-selector-current small muted">
          Viewing: {currentBranch.name}
        </span>
      )}
    </div>
  );
}
