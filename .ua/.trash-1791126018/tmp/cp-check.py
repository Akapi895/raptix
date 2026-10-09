import json
d = json.load(open(r"D:\.VTNet\redteam\raptix\.ua\intermediate\batch-138.json", encoding="utf-8"))
s = [n for n in d["nodes"] if n["type"]=="function"][0]["summary"]
print("len:", len(s))
print("codepoints:", " ".join("%04X" % ord(c) for c in s[:12]))
open(r"D:\.VTNet\redteam\raptix\.ua\tmp\snippet-check.txt","w",encoding="utf-8").write(s)
