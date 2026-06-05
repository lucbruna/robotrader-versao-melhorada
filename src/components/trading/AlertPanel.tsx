import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell,
  Plus,
  Settings,
  Trash2,
  Clock,
  MessageCircle,
} from "lucide-react";
import { alertManager, type AlertConfig, type AlertEvent } from "@/lib/alerts";
import { telegramSendAlert, telegramStatus } from "@/lib/ai-client";

interface AlertPanelProps {
  symbol: string;
  price: number;
}

export function AlertPanel({ symbol, price }: AlertPanelProps) {
  const [alerts, setAlerts] = useState<AlertConfig[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [tgReady, setTgReady] = useState(false);

  useEffect(() => {
    // Load alerts
    const savedAlerts = localStorage.getItem(`alerts_${symbol}`);
    if (savedAlerts) {
      const parsed = JSON.parse(savedAlerts);
      parsed.forEach((alert: AlertConfig) => {
        alertManager.addAlert(alert);
      });
    }

    // Check Telegram status
    void telegramStatus().then((s) => setTgReady(!!s?.configured));

    // Setup event listener — also forward to Telegram if WEBHOOK channel enabled
    const handleAlertEvent = (event: AlertEvent) => {
      setEvents((prev) => [event, ...prev.slice(0, 19)]); // Keep last 20 events
      const alertChannels: string[] = ((event.data as { alert?: AlertConfig })
        ?.alert?.channels || []) as string[];
      if (alertChannels.includes("WEBHOOK")) {
        void telegramSendAlert(event);
      }
    };

    alertManager.on("alert", handleAlertEvent);
    setAlerts(alertManager.getAlert(symbol));

    return () => {
      alertManager.off("alert");
    };
  }, [symbol]);

  useEffect(() => {
    // Auto-save alerts
    const symbolAlerts = alertManager.getAlert(symbol);
    setAlerts(symbolAlerts);
    localStorage.setItem(`alerts_${symbol}`, JSON.stringify(symbolAlerts));
  }, [symbol]);

  const createAlert = (type: "PRICE" | "RSI" | "AI") => {
    let alert: AlertConfig;

    switch (type) {
      case "PRICE":
        alert = alertManager.createPriceAlert(symbol, price, "ABOVE");
        break;
      case "RSI":
        alert = alertManager.createTechnicalAlert(symbol, "RSI", 70, "ABOVE");
        break;
      case "AI":
        alert = alertManager.createAISignalAlert(symbol, 75);
        break;
      default:
        return;
    }

    alertManager.addAlert(alert);
    setShowAddForm(false);
  };

  const removeAlert = (alertId: string) => {
    alertManager.removeAlert(alertId);
  };

  const toggleTelegramChannel = (alert: AlertConfig) => {
    const hasTg = alert.channels.includes("WEBHOOK");
    const next: AlertConfig["channels"] = hasTg
      ? alert.channels.filter((c) => c !== "WEBHOOK")
      : [...alert.channels, "WEBHOOK"];
    alertManager.updateAlert(alert.id, { channels: next });
    setAlerts(alertManager.getAlert(symbol));
    const symbolAlerts = alertManager.getAlert(symbol);
    localStorage.setItem(`alerts_${symbol}`, JSON.stringify(symbolAlerts));
  };

  const getSignalColor = (priority: AlertConfig["priority"]) => {
    switch (priority) {
      case "URGENT":
        return "text-red-600 bg-red-50 border-red-200";
      case "HIGH":
        return "text-orange-600 bg-orange-50 border-orange-200";
      case "MEDIUM":
        return "text-yellow-600 bg-yellow-50 border-yellow-200";
      case "LOW":
        return "text-green-600 bg-green-50 border-green-200";
      default:
        return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  const getSignalIcon = (type: string) => {
    switch (type) {
      case "PRICE":
        return "💰";
      case "TECHNICAL":
        return "📊";
      case "AI_SIGNAL":
        return "🤖";
      default:
        return "⚠️";
    }
  };

  const recentEvents = events
    .filter((event) => event.symbol === symbol)
    .slice(0, 10);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Sinais de Alerta - {symbol}
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant={showAddForm ? "secondary" : "default"}
              size="sm"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Adicionar
            </Button>
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4 mr-1" />
              Configurar
            </Button>
          </div>
        </CardHeader>

        {showAddForm && (
          <CardContent className="border-t">
            <div className="grid grid-cols-3 gap-2 p-4">
              <Button
                variant="outline"
                onClick={() => createAlert("PRICE")}
                className="h-20 flex flex-col items-center justify-center"
              >
                <span className="text-2xl mb-1">💰</span>
                Alerta de Preço
              </Button>
              <Button
                variant="outline"
                onClick={() => createAlert("RSI")}
                className="h-20 flex flex-col items-center justify-center"
              >
                <span className="text-2xl mb-1">📊</span>
                Alerta Técnico
              </Button>
              <Button
                variant="outline"
                onClick={() => createAlert("AI")}
                className="h-20 flex flex-col items-center justify-center"
              >
                <span className="text-2xl mb-1">🤖</span>
                Alerta IA
              </Button>
            </div>
          </CardContent>
        )}

        <CardContent>
          <div className="space-y-3">
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum alerta configurado. Clique "Adicionar" para criar
                alertas.
              </p>
            ) : (
              <ScrollArea className="h-64">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-3 rounded-lg border ${getSignalColor(alert.priority)}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">
                          {getSignalIcon(alert.trigger.type)}
                        </span>
                        <div>
                          <p className="font-medium text-sm">{alert.name}</p>
                          <p className="text-xs opacity-75">
                            Disparado {alert.triggerCount} vezes
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeAlert(alert.id)}
                          className="h-6 w-6 p-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="text-xs">
                          {alert.trigger.type}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {alert.priority}
                        </Badge>
                        {alert.lastTriggered && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {Math.floor(
                              (Date.now() - alert.lastTriggered) / 60000,
                            )}
                            m atrás
                          </div>
                        )}
                        <label
                          className={`ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${
                            alert.channels.includes("WEBHOOK")
                              ? "bg-blue-500/15 text-blue-600"
                              : "bg-muted text-muted-foreground"
                          } ${!tgReady ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-blue-500/20"}`}
                          title={
                            tgReady
                              ? "Enviar este alerta pro Telegram"
                              : "Telegram não configurado"
                          }
                        >
                          <input
                            type="checkbox"
                            className="h-3 w-3"
                            checked={alert.channels.includes("WEBHOOK")}
                            disabled={!tgReady}
                            onChange={() => toggleTelegramChannel(alert)}
                          />
                          <MessageCircle className="h-3 w-3" />
                          <span>Telegram</span>
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
              </ScrollArea>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent Events */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Sinais Recentes</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-48">
            {recentEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum sinal recente
              </p>
            ) : (
              <div className="space-y-2">
                {recentEvents.map((event) => (
                  <div
                    key={event.id}
                    className={`p-2 rounded border-l-4 ${
                      event.priority === "URGENT"
                        ? "border-red-500 bg-red-50"
                        : event.priority === "HIGH"
                          ? "border-orange-500 bg-orange-50"
                          : event.priority === "MEDIUM"
                            ? "border-yellow-500 bg-yellow-50"
                            : "border-green-500 bg-green-50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {event.symbol}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {event.type}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-xs mt-1">{event.message}</p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
