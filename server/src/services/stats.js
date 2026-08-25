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
    `SELECT COUNT(*) FILTER (WHERE a.status = 'present') AS present,
            COUNT(*) FILTER (WHERE a.status = 'absent')  AS absent,
            COUNT(*) FILTER (WHERE a.status = 'excused') AS excused,
            COUNT(*) AS marked,
            COUNT(*) FILTER (WHERE a.status = 'present' AND m.gender = 'male')   AS present_male,
            COUNT(*) FILTER (WHERE a.status = 'present' AND m.gender = 'female') AS present_female,
            COUNT(*) FILTER (WHERE a.status = 'present' AND m.gender IS NULL)    AS present_unspecified,
            COUNT(*) FILTER (WHERE a.status = 'absent' AND m.gender = 'male')    AS absent_male,
            COUNT(*) FILTER (WHERE a.status = 'absent' AND m.gender = 'female')  AS absent_female,
            COUNT(*) FILTER (WHERE a.status = 'excused' AND m.gender = 'male')   AS excused_male,
            COUNT(*) FILTER (WHERE a.status = 'excused' AND m.gender = 'female') AS excused_female
       FROM attendance a
       JOIN members m ON m.id = a.member_id
      WHERE a.service_id = $1`,
    [serviceId]
  );
  const r = rows[0];
  const num = (v) => Number(v);
  return {
    present: num(r.present),
    absent: num(r.absent),
    excused: num(r.excused),
    marked: num(r.marked),
    present_male: num(r.present_male),
    present_female: num(r.present_female),
    present_unspecified: num(r.present_unspecified),
    absent_male: num(r.absent_male),
    absent_female: num(r.absent_female),
    excused_male: num(r.excused_male),
    excused_female: num(r.excused_female),
  };
}

module.exports = { recomputeMemberStats, getServiceTotals };