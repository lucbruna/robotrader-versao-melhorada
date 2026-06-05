import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Bot,
  Settings,
  Play,
  Pause,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import BinanceTradingAPI from "@/lib/trading-api";
import OllamaClient from "@/lib/ollama";
import { alertManager, type AlertConfig } from "@/lib/alerts";
import type { AIDecision } from "@/lib/ai-signal.functions";

type TradeEvent = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  timestamp: number;
  signal: AIDecision;
};

interface TradingPanelProps {
  symbol: string;
  price: number;
  aiSignal?: AIDecision | null;
  onTrade?: (trade: TradeEvent) => void;
}

interface TradingAPIConfig {
  enabled: boolean;
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
  autoTrading: boolean;
  riskPerTrade: number;
  maxPositions: number;
}

interface OllamaConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  confidenceThreshold: number;
}

interface TradingPanelProps {
  symbol: string;
  price: number;
  aiSignal?: AIDecision | null;
  onTrade?: (trade: TradeEvent) => void;
}

export function TradingPanel({
  symbol,
  price,
  aiSignal,
  onTrade,
}: TradingPanelProps) {
  const [apiConfig, setApiConfig] = useState<TradingAPIConfig>({
    enabled: false,
    apiKey: "",
    apiSecret: "",
    testnet: true,
    autoTrading: false,
    riskPerTrade: 2,
    maxPositions: 3,
  });

  const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig>({
    enabled: false,
    baseUrl: "http://localhost:11434",
    model: "llama3.1:8b",
    confidenceThreshold: 75,
  });

  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [ollamaStatus, setOllamaStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [tradingApi, setTradingApi] = useState<BinanceTradingAPI | null>(null);
  const [ollamaClient, setOllamaClient] = useState<OllamaClient | null>(null);
  const [alerts, setAlerts] = useState<AlertConfig[]>([]);
  const [isTrading, setIsTrading] = useState(false);

  useEffect(() => {
    // Load configurations from localStorage
    const savedApiConfig = localStorage.getItem("trading_api_config");
    const savedOllamaConfig = localStorage.getItem("ollama_config");

    if (savedApiConfig) {
      setApiConfig({ ...apiConfig, ...JSON.parse(savedApiConfig) });
    }

    if (savedOllamaConfig) {
      setOllamaConfig({ ...ollamaConfig, ...JSON.parse(savedOllamaConfig) });
    }
  }, []);

  useEffect(() => {
    // Save configurations
    localStorage.setItem("trading_api_config", JSON.stringify(apiConfig));
    localStorage.setItem("ollama_config", JSON.stringify(ollamaConfig));
  }, [apiConfig, ollamaConfig]);

  useEffect(() => {
    // Initialize clients when configs change
    if (apiConfig.enabled && apiConfig.apiKey && apiConfig.apiSecret) {
      setConnectionStatus("connecting");
      const client = new BinanceTradingAPI(
        apiConfig.apiKey,
        apiConfig.apiSecret,
      );
      setTradingApi(client);

      // Test connection
      client
        .testOrder({
          symbol,
          side: "BUY",
          type: "MARKET",
          quantity: "0.001",
        })
        .then(() => {
          setConnectionStatus("connected");
        })
        .catch(() => {
          setConnectionStatus("disconnected");
        });
    } else {
      setConnectionStatus("disconnected");
      setTradingApi(null);
    }

    if (ollamaConfig.enabled) {
      setOllamaStatus("connecting");
      const client = new OllamaClient(ollamaConfig.baseUrl);
      setOllamaClient(client);

      // Test connection
      client.testConnection().then(({ connected }) => {
        setOllamaStatus(connected ? "connected" : "disconnected");
      });
    } else {
      setOllamaStatus("disconnected");
      setOllamaClient(null);
    }
  }, [apiConfig, ollamaConfig, symbol]);

  useEffect(() => {
    // Load alerts
    const savedAlerts = localStorage.getItem(`trading_alerts_${symbol}`);
    if (savedAlerts) {
      const parsed = JSON.parse(savedAlerts);
      parsed.forEach((alert: AlertConfig) => {
        alertManager.addAlert(alert);
      });
      setAlerts(alertManager.getAlert(symbol));
    }
  }, [symbol]);

  useEffect(() => {
    // Auto-trade when conditions are met
    if (
      apiConfig.autoTrading &&
      tradingApi &&
      connectionStatus === "connected" &&
      aiSignal
    ) {
      executeTrade(aiSignal);
    }
  }, [aiSignal, apiConfig.autoTrading, tradingApi, connectionStatus]);

  const executeTrade = async (signal: AIDecision) => {
    if (!tradingApi || connectionStatus !== "connected") return;

    setIsTrading(true);

    try {
      // Get account info
      const accountInfo = await tradingApi.getAccountInfo();
      const balance = parseFloat(
        accountInfo.balances.find((b: { asset: string }) => b.asset === "USDT")
          ?.free || "0",
      );

      // Calculate position size based on risk
      const riskAmount = balance * (apiConfig.riskPerTrade / 100);
      const positionSize = riskAmount / price;

      if (positionSize < 0.001) {
        console.log("Position size too small for trading");
        return;
      }

      // Execute trade based on signal
      const side = signal.action === "BUY" ? "BUY" : "SELL";

      const order = await tradingApi.placeOrder({
        symbol,
        side,
        type: "MARKET",
        quantity: positionSize.toFixed(6),
      });

      // Trigger trade event
      onTrade?.({
        id: String(Date.now()),
        symbol,
        side,
        quantity: positionSize,
        price,
        timestamp: Date.now(),
        signal,
      });

      // Add trading alert
      alertManager.addAlert(alertManager.createSmartAlert(symbol));
    } catch (error) {
      console.error("Trade execution error:", error);
    } finally {
      setIsTrading(false);
    }
  };

  const testConnection = async () => {
    if (!tradingApi) return;

    setConnectionStatus("connecting");
    try {
      await tradingApi.getAccountInfo();
      setConnectionStatus("connected");
    } catch {
      setConnectionStatus("disconnected");
    }
  };

  const testOllama = async () => {
    if (!ollamaClient) return;

    setOllamaStatus("connecting");
    try {
      const result = await ollamaClient.testConnection();
      setOllamaStatus(result.connected ? "connected" : "disconnected");
    } catch {
      setOllamaStatus("disconnected");
    }
  };

  const getStatusIcon = (status: typeof connectionStatus) => {
    switch (status) {
      case "connected":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "connecting":
        return <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />;
      case "disconnected":
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
    }
  };

  const getSignalColor = (action: string) => {
    switch (action) {
      case "BUY":
        return "text-green-600 bg-green-50 border-green-200";
      case "SELL":
        return "text-red-600 bg-red-50 border-red-200";
      case "HOLD":
        return "text-yellow-600 bg-yellow-50 border-yellow-200";
      default:
        return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  return (
    <div className="space-y-4">
      {/* API Trading Configuration */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            API Trading
          </CardTitle>
          <Badge
            variant={
              connectionStatus === "connected" ? "default" : "destructive"
            }
          >
            {getStatusIcon(connectionStatus)}
            {connectionStatus === "connected"
              ? "Conectado"
              : connectionStatus === "connecting"
                ? "Conectando..."
                : "Desconectado"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              checked={apiConfig.enabled}
              onCheckedChange={(checked) =>
                setApiConfig({ ...apiConfig, enabled: checked })
              }
            />
            <Label>Ativar API Trading</Label>
          </div>

          {apiConfig.enabled && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>API Key</Label>
                  <Input
                    value={apiConfig.apiKey}
                    onChange={(e) =>
                      setApiConfig({ ...apiConfig, apiKey: e.target.value })
                    }
                    placeholder="Sua API Key"
                    type="password"
                  />
                </div>
                <div>
                  <Label>API Secret</Label>
                  <Input
                    value={apiConfig.apiSecret}
                    onChange={(e) =>
                      setApiConfig({ ...apiConfig, apiSecret: e.target.value })
                    }
                    placeholder="Sua API Secret"
                    type="password"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={apiConfig.testnet}
                  onCheckedChange={(checked) =>
                    setApiConfig({ ...apiConfig, testnet: checked })
                  }
                />
                <Label>Usar Testnet</Label>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={apiConfig.autoTrading}
                  onCheckedChange={(checked) =>
                    setApiConfig({ ...apiConfig, autoTrading: checked })
                  }
                />
                <Label>Trading Automático</Label>
              </div>

              <div className="space-y-2">
                <Label>Risco por Trade: {apiConfig.riskPerTrade}%</Label>
                <Slider
                  value={[apiConfig.riskPerTrade]}
                  onValueChange={([value]) =>
                    setApiConfig({ ...apiConfig, riskPerTrade: value })
                  }
                  max={10}
                  min={0.5}
                  step={0.5}
                  className="w-full"
                />
              </div>

              <Button
                onClick={testConnection}
                disabled={connectionStatus === "connecting"}
                className="w-full"
              >
                {connectionStatus === "connecting" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testando Conexão...
                  </>
                ) : (
                  "Testar Conexão"
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Ollama Configuration */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Ollama IA
          </CardTitle>
          <Badge
            variant={ollamaStatus === "connected" ? "default" : "destructive"}
          >
            {getStatusIcon(ollamaStatus)}
            {ollamaStatus === "connected"
              ? "Conectado"
              : ollamaStatus === "connecting"
                ? "Conectando..."
                : "Desconectado"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              checked={ollamaConfig.enabled}
              onCheckedChange={(checked) =>
                setOllamaConfig({ ...ollamaConfig, enabled: checked })
              }
            />
            <Label>Ativar Ollama</Label>
          </div>

          {ollamaConfig.enabled && (
            <>
              <div>
                <Label>URL do Ollama</Label>
                <Input
                  value={ollamaConfig.baseUrl}
                  onChange={(e) =>
                    setOllamaConfig({
                      ...ollamaConfig,
                      baseUrl: e.target.value,
                    })
                  }
                  placeholder="http://localhost:11434"
                />
              </div>

              <div>
                <Label>Modelo</Label>
                <Select
                  value={ollamaConfig.model}
                  onValueChange={(value) =>
                    setOllamaConfig({ ...ollamaConfig, model: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="llama3.1:8b">Llama 3.1 8B</SelectItem>
                    <SelectItem value="llama3:8b">Llama 3 8B</SelectItem>
                    <SelectItem value="mistral:7b">Mistral 7B</SelectItem>
                    <SelectItem value="gemma:7b">Gemma 7B</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>
                  Limite de Confiança: {ollamaConfig.confidenceThreshold}%
                </Label>
                <Slider
                  value={[ollamaConfig.confidenceThreshold]}
                  onValueChange={([value]) =>
                    setOllamaConfig({
                      ...ollamaConfig,
                      confidenceThreshold: value,
                    })
                  }
                  max={100}
                  min={50}
                  step={5}
                  className="w-full"
                />
              </div>

              <Button
                onClick={testOllama}
                disabled={ollamaStatus === "connecting"}
                className="w-full"
              >
                {ollamaStatus === "connecting" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testando Conexão...
                  </>
                ) : (
                  "Testar Conexão"
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Current Signal */}
      {aiSignal && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              Sinal Atual - {symbol}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`p-4 rounded-lg border ${getSignalColor(aiSignal.action)}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{aiSignal.action}</Badge>
                    <span className="font-bold">
                      {aiSignal.confidence}% Confiança
                    </span>
                  </div>
                  <p className="text-sm mt-2">{aiSignal.rationale}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold">${price.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">
                    {aiSignal.takeProfit &&
                      `Alvo: $${aiSignal.takeProfit.toFixed(2)}`}
                    {aiSignal.stopLoss &&
                      ` | Stop: $${aiSignal.stopLoss.toFixed(2)}`}
                  </p>
                </div>
              </div>

              {apiConfig.autoTrading && connectionStatus === "connected" && (
                <div className="mt-4 p-2 bg-blue-50 border border-blue-200 rounded">
                  <p className="text-sm text-blue-700">
                    🤖 Trading automático ativado. Executando trades quando
                    condições forem atendidas.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trade Execution */}
      <Card>
        <CardHeader>
          <CardTitle>Execução Manual</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() =>
                executeTrade({
                  action: "BUY",
                  confidence: 80,
                  entry: price,
                  stopLoss: price * 0.98,
                  takeProfit: price * 1.04,
                  rationale: "Manual buy",
                  risk: "MEDIUM",
                  regime: "RANGE",
                  rMultiple: 2,
                  invalidation: "Stop loss",
                  ttl: 240,
                })
              }
              disabled={
                isTrading || !tradingApi || connectionStatus !== "connected"
              }
              className="bg-green-600 hover:bg-green-700"
            >
              {isTrading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Executando...
                </>
              ) : (
                "Comprar"
              )}
            </Button>
            <Button
              onClick={() =>
                executeTrade({
                  action: "SELL",
                  confidence: 80,
                  entry: price,
                  stopLoss: price * 1.02,
                  takeProfit: price * 0.96,
                  rationale: "Manual sell",
                  risk: "MEDIUM",
                  regime: "RANGE",
                  rMultiple: 2,
                  invalidation: "Stop loss",
                  ttl: 240,
                })
              }
              disabled={
                isTrading || !tradingApi || connectionStatus !== "connected"
              }
              variant="destructive"
            >
              {isTrading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Executando...
                </>
              ) : (
                "Vender"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
