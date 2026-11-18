-- Release 0022 added new starter label templates as defaults even where a facility already had one,
-- leaving some label types with several defaults. Keep exactly one per facility and label type:
-- the New Mexico 4x4 flower product label where it exists (older NM product templates no longer
-- meet the checked rules), otherwise the oldest default.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY facility_id, kind
           ORDER BY (name = 'NM product label 4×4 (flower)') DESC, created_at ASC, id ASC
         ) AS rn
  FROM label_templates
  WHERE is_default = true
)
UPDATE label_templates SET is_default = false
FROM ranked
WHERE label_templates.id = ranked.id AND ranked.rn > 1;
