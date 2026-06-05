import { z } from "zod";

const TradingOrderSchema = z.object({
  symbol: z.string(),
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT", "STOP_LOSS", "TAKE_PROFIT"]),
  quantity: z.string(),
  price: z.string().optional(),
  stopPrice: z.string().optional(),
  timeInForce: z.enum(["GTC", "IOC", "FOK"]).optional(),
});

export type TradingOrder = z.infer<typeof TradingOrderSchema>;

const AccountInfoSchema = z.object({
  accountType: z.string(),
  balances: z.array(
    z.object({
      asset: z.string(),
      free: z.string(),
      locked: z.string(),
    }),
  ),
});

export type AccountInfo = z.infer<typeof AccountInfoSchema>;

const PositionSchema = z.object({
  symbol: z.string(),
  side: z.enum(["LONG", "SHORT"]),
  quantity: z.string(),
  entryPrice: z.string(),
  markPrice: z.string(),
  pnl: z.string(),
  roi: z.string(),
});

export type Position = z.infer<typeof PositionSchema>;

class BinanceTradingAPI {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string = "https://api.binance.com";

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  private async makeRequest(
    endpoint: string,
    method: "GET" | "POST" = "GET",
    params: Record<string, string> = {},
  ) {
    const url = `${this.baseUrl}${endpoint}`;
    const queryString = new URLSearchParams({
      ...params,
      timestamp: Date.now().toString(),
    }).toString();

    const signature = await this.generateSignature(queryString);
    const fullUrl = `${url}?${queryString}&signature=${signature}`;

    const response = await fetch(fullUrl, {
      method,
      headers: {
        "X-MBX-APIKEY": this.apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Binance API Error: ${response.status} ${response.statusText}`,
      );
    }

    return response.json();
  }

  private async generateSignature(queryString: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(this.apiSecret);
    const messageData = encoder.encode(queryString);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async getAccountInfo(): Promise<AccountInfo> {
    const data = await this.makeRequest("/api/v3/account");
    return AccountInfoSchema.parse(data);
  }

  async getPositions(): Promise<Position[]> {
    const data = await this.makeRequest("/api/v3/positionRisk");
    return PositionSchema.array().parse(data);
  }

  async placeOrder(order: TradingOrder): Promise<unknown> {
    const validatedOrder = TradingOrderSchema.parse(order);
    return await this.makeRequest("/api/v3/order", "POST", validatedOrder);
  }

  async cancelOrder(symbol: string, orderId: string): Promise<unknown> {
    return await this.makeRequest("/api/v3/order", "POST", {
      symbol,
      orderId,
    });
  }

  async getOrderStatus(symbol: string, orderId: string): Promise<unknown> {
    return await this.makeRequest("/api/v3/order", "GET", {
      symbol,
      orderId,
    });
  }

  async getOpenOrders(symbol?: string): Promise<unknown[]> {
    const params: Record<string, string> = {};
    if (symbol) params.symbol = symbol;
    return await this.makeRequest("/api/v3/openOrders", "GET", params);
  }

  async getTradeHistory(
    symbol: string,
    limit: number = 500,
  ): Promise<unknown[]> {
    return await this.makeRequest("/api/v3/myTrades", "GET", {
      symbol,
      limit: limit.toString(),
    });
  }

  async testOrder(order: TradingOrder): Promise<unknown> {
    const validatedOrder = TradingOrderSchema.parse(order);
    return await this.makeRequest("/api/v3/order/test", "POST", validatedOrder);
  }
}

export default BinanceTradingAPI;
