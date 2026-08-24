/**
 * Recompute consecutive_absences + last_attended for one member.
 * Streak counts the most recent consecutive services marked absent.
 * present resets the streak; excused stops counting without punishing.
 */
async function recomputeMemberStats(db, memberId) {
  const { rows } = await db.query(
    `SELECT a.status
       FROM attendance a
       JOIN services s ON s.id = a.service_id
      WHERE a.member_id = $1
      ORDER BY s.service_date DESC, a.updated_at DESC`,
    [memberId]
  );
  let streak = 0;
  let counting = false;
  for (const row of rows) {
    if (!counting) {
      if (row.status === 'absent') {
        counting = true;
        streak = 1;
      } else {
        break; // present or excused at the top => no streak
      }
    } else if (row.status === 'absent') {
      streak += 1;
    } else {
      break;
    }
  }
  await db.query(
    `UPDATE members
        SET last_attended = (
              SELECT MAX(s.service_date)
                FROM attendance a
                JOIN services s ON s.id = a.service_id
               WHERE a.member_id = $1 AND a.status = 'present'
            ),
            consecutive_absences = $2
      WHERE id = $1`,
    [memberId, streak]
  );
  return streak;
}

async function getServiceTotals(db, serviceId) {
  const { rows } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'present') AS present,
            COUNT(*) FILTER (WHERE status = 'absent')  AS absent,
            COUNT(*) FILTER (WHERE status = 'excused') AS excused,
            COUNT(*) AS marked
       FROM attendance
      WHERE service_id = $1`,
    [serviceId]
  );
  const r = rows[0];
  return {
    present: Number(r.present),
    absent: Number(r.absent),
    excused: Number(r.excused),
    marked: Number(r.marked),
  };
}

module.exports = { recomputeMemberStats, getServiceTotals };