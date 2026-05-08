'use strict';

const router = require('express').Router();
const { query } = require('../db/connection');

// GET /api/costs — resumo de custos por período
router.get('/', async (req, res, next) => {
  try {
    const [assemblyai, openai, byDay, topJobs] = await Promise.all([
      // AssemblyAI: custo por período
      query(`
        SELECT
          COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day'),  0) AS today,
          COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0) AS week,
          COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'),0) AS month,
          COALESCE(SUM(estimated_cost_usd), 0) AS total
        FROM transcriptions
      `),

      // OpenAI (GPT): custo por período (salvo em jobs.estimated_cost_usd)
      query(`
        SELECT
          COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day'),  0) AS today,
          COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0) AS week,
          COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'),0) AS month,
          COALESCE(SUM(estimated_cost_usd), 0) AS total
        FROM jobs
        WHERE estimated_cost_usd IS NOT NULL
      `),

      // Custo diário dos últimos 14 dias (AssemblyAI + OpenAI)
      query(`
        SELECT
          date_trunc('day', day) AS date,
          COALESCE(SUM(ai_cost), 0) + COALESCE(SUM(gpt_cost), 0) AS total
        FROM (
          SELECT created_at AS day, estimated_cost_usd AS ai_cost, NULL AS gpt_cost
          FROM transcriptions WHERE created_at >= NOW() - INTERVAL '14 days'
          UNION ALL
          SELECT created_at AS day, NULL AS ai_cost, estimated_cost_usd AS gpt_cost
          FROM jobs WHERE estimated_cost_usd IS NOT NULL AND created_at >= NOW() - INTERVAL '14 days'
        ) t
        GROUP BY date_trunc('day', day)
        ORDER BY date ASC
      `),

      // Top 5 jobs mais caros
      query(`
        SELECT
          j.id, j.title, j.content_type, j.created_at,
          COALESCE(t.estimated_cost_usd, 0)  AS assemblyai_cost,
          COALESCE(j.estimated_cost_usd, 0)  AS openai_cost,
          COALESCE(t.estimated_cost_usd, 0) + COALESCE(j.estimated_cost_usd, 0) AS total_cost
        FROM jobs j
        LEFT JOIN transcriptions t ON t.job_id = j.id
        WHERE t.estimated_cost_usd IS NOT NULL OR j.estimated_cost_usd IS NOT NULL
        ORDER BY total_cost DESC
        LIMIT 5
      `),
    ]);

    const ai  = assemblyai.rows[0];
    const gpt = openai.rows[0];

    res.json({
      assemblyai: {
        today: parseFloat(ai.today),
        week:  parseFloat(ai.week),
        month: parseFloat(ai.month),
        total: parseFloat(ai.total),
      },
      openai: {
        today: parseFloat(gpt.today),
        week:  parseFloat(gpt.week),
        month: parseFloat(gpt.month),
        total: parseFloat(gpt.total),
      },
      combined: {
        today: parseFloat(ai.today) + parseFloat(gpt.today),
        week:  parseFloat(ai.week)  + parseFloat(gpt.week),
        month: parseFloat(ai.month) + parseFloat(gpt.month),
        total: parseFloat(ai.total) + parseFloat(gpt.total),
      },
      by_day: byDay.rows.map(r => ({
        date:  r.date,
        total: parseFloat(r.total),
      })),
      top_jobs: topJobs.rows.map(r => ({
        id:            r.id,
        title:         r.title,
        content_type:  r.content_type,
        created_at:    r.created_at,
        assemblyai:    parseFloat(r.assemblyai_cost),
        openai:        parseFloat(r.openai_cost),
        total:         parseFloat(r.total_cost),
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
