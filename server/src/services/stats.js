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
  // "Unmarked means absent": the pool is every active member; members with no
  // attendance record for this service are counted as absent (with their gender,
  // when known) rather than in a separate bucket.
  const { rows } = await db.query(
    `SELECT COUNT(*) AS eligible,
            COUNT(a.id) AS marked,
            COUNT(*) FILTER (WHERE a.status = 'present') AS present,
            COUNT(*) FILTER (WHERE a.status = 'absent')  AS absent_marked,
            COUNT(*) FILTER (WHERE a.status = 'excused') AS excused,
            COUNT(*) FILTER (WHERE a.id IS NULL) AS unmarked,
            COUNT(*) FILTER (WHERE a.status = 'present' AND m.gender = 'male')   AS present_male,
            COUNT(*) FILTER (WHERE a.status = 'present' AND m.gender = 'female') AS present_female,
            COUNT(*) FILTER (WHERE a.status = 'present' AND m.gender IS NULL)    AS present_unspecified,
            COUNT(*) FILTER (WHERE (a.status = 'absent' OR a.id IS NULL) AND m.gender = 'male')   AS absent_male,
            COUNT(*) FILTER (WHERE (a.status = 'absent' OR a.id IS NULL) AND m.gender = 'female') AS absent_female,
            COUNT(*) FILTER (WHERE (a.status = 'absent' OR a.id IS NULL) AND m.gender IS NULL)    AS absent_unspecified,
            COUNT(*) FILTER (WHERE a.status = 'excused' AND m.gender = 'male')   AS excused_male,
            COUNT(*) FILTER (WHERE a.status = 'excused' AND m.gender = 'female') AS excused_female
       FROM members m
       LEFT JOIN attendance a ON a.member_id = m.id AND a.service_id = $1
      WHERE m.status = 'active'`,
    [serviceId]
  );
  const r = rows[0];
  const num = (v) => Number(v);
  const eligible = num(r.eligible);
  const unmarked = num(r.unmarked);
  return {
    eligible,
    marked: num(r.marked),
    present: num(r.present),
    absent: num(r.absent_marked) + unmarked,
    excused: num(r.excused),
    unmarked,
    present_male: num(r.present_male),
    present_female: num(r.present_female),
    present_unspecified: num(r.present_unspecified),
    absent_male: num(r.absent_male),
    absent_female: num(r.absent_female),
    absent_unspecified: num(r.absent_unspecified),
    excused_male: num(r.excused_male),
    excused_female: num(r.excused_female),
  };
}

module.exports = { recomputeMemberStats, getServiceTotals };