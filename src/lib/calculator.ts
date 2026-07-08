// calculator.ts — 行末の算術式(例: `3 * 8 =`)を安全に評価する(SPEC.md §7 v1確定)
// eval/Functionは使わず、トークナイズ+再帰下降パーサで構文解析する(安全性)。
// 対応演算: + - * / ( ) と小数。

type Token = { type: "num" | "op" | "lparen" | "rparen"; value: string };

const TOKEN_PATTERN = /\s*(\d+(?:\.\d+)?|[+\-*/()])\s*/g;

function tokenizeExpr(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let lastIndex = 0;
  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(expr))) {
    if (match.index !== lastIndex) return null; // 解釈できない文字が途中にある
    const value = match[1];
    lastIndex = TOKEN_PATTERN.lastIndex;
    if (/^\d/.test(value)) tokens.push({ type: "num", value });
    else if (value === "(") tokens.push({ type: "lparen", value });
    else if (value === ")") tokens.push({ type: "rparen", value });
    else tokens.push({ type: "op", value });
  }
  if (lastIndex !== expr.length) return null; // 末尾に解釈できない文字が残っている
  return tokens;
}

class ExprParser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): number | null {
    if (this.tokens.length === 0) return null;
    try {
      const value = this.parseExpr();
      return this.pos === this.tokens.length ? value : null;
    } catch {
      return null;
    }
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const token = this.tokens[this.pos];
    if (!token) throw new Error("unexpected end of expression");
    this.pos += 1;
    return token;
  }

  private parseExpr(): number {
    let value = this.parseTerm();
    let token = this.peek();
    while (token?.type === "op" && (token.value === "+" || token.value === "-")) {
      this.next();
      const rhs = this.parseTerm();
      value = token.value === "+" ? value + rhs : value - rhs;
      token = this.peek();
    }
    return value;
  }

  private parseTerm(): number {
    let value = this.parseFactor();
    let token = this.peek();
    while (token?.type === "op" && (token.value === "*" || token.value === "/")) {
      this.next();
      const rhs = this.parseFactor();
      value = token.value === "*" ? value * rhs : value / rhs;
      token = this.peek();
    }
    return value;
  }

  private parseFactor(): number {
    const token = this.next();
    if (token.type === "num") return Number(token.value);
    if (token.type === "op" && token.value === "-") return -this.parseFactor();
    if (token.type === "lparen") {
      const value = this.parseExpr();
      const close = this.next();
      if (close.type !== "rparen") throw new Error("expected )");
      return value;
    }
    throw new Error(`unexpected token: ${token.value}`);
  }
}

export function evaluateExpression(expr: string): number | null {
  const tokens = tokenizeExpr(expr);
  if (!tokens) return null;
  return new ExprParser(tokens).parse();
}

const CALC_LINE_PATTERN = /^(.*?)=\s*$/;

/** `3 * 8 =` のような行から式と計算結果を取り出す。マッチ/評価不能ならnull。 */
export function evaluateLineIfCalculator(line: string): { expr: string; result: number } | null {
  const match = line.match(CALC_LINE_PATTERN);
  if (!match) return null;
  const expr = match[1].trim();
  if (!expr) return null;
  const result = evaluateExpression(expr);
  if (result === null || Number.isNaN(result) || !Number.isFinite(result)) return null;
  return { expr, result };
}
