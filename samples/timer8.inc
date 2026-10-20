-- Prototype for an 8-bit down-counting timer (sample include file)
FUNCTION timer8 (clock, load, data[7..0])
	WITH (WIDTH)
	RETURNS (done, count[7..0]);
