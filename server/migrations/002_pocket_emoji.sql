ALTER TABLE pockets ADD COLUMN emoji TEXT NOT NULL DEFAULT '';
UPDATE pockets SET emoji = CASE kind
  WHEN 'bank' THEN char(0x1F3E6) WHEN 'cash' THEN char(0x1F4B5)
  WHEN 'fund' THEN char(0x1F331) ELSE char(0x1F4C8) END;
