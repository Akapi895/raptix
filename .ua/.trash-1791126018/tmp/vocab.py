#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Trich tu vung tu gen-batches-11-15.py de lap ban do dau tieng Viet."""
import re, pathlib, collections
src = pathlib.Path("D:/.VTNet/redteam/raptix/.ua/tmp/gen-batches-11-15.py").read_text(encoding="utf-8")
words = re.findall(r"[A-Za-z]+", src)
c = collections.Counter(w.lower() for w in words)
# in cac tu thuong gap trong summary (bo qua tu khoa python/tieng Anh ky thuat)
tech = {"import","def","return","for","in","if","else","elif","not","and","or","none","true","false",
"file","function","class","path","name","type","tags","summary","nodes","edges","batch","results",
"exports","contains","imports","calls","inherits","tested","forward","weight","complexity","simple",
"moderate","complex","react","hook","store","mock","demo","real","mode","api","http","json","markdown",
"cli","ink","tsx","ts","py","css","html","url","id","ui","ux","svg","d3","force","websocket","xterm",
"base","cva","cn","clsx","bland"}
out = []
for w, n in c.most_common(400):
    if n >= 4 and w not in tech and len(w) > 2:
        out.append("%s (%d)" % (w, n))
open("D:/.VTNet/redteam/raptix/.ua/tmp/vocab.txt", "w", encoding="utf-8").write("\n".join(out))
print("\n".join(out[:120]))
