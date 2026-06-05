export interface AlertTrigger {
  type: "PRICE" | "TECHNICAL" | "AI_SIGNAL" | "VOLUME" | "TIME";
  condition: "ABOVE" | "BELOW" | "EQUALS" | "CROSSES_ABOVE" | "CROSSES_BELOW";
  value: number;
  timeframe?: string;
}

export interface AlertConfig {
  id: string;
  symbol: string;
  name: string;
  trigger: AlertTrigger;
  enabled: boolean;
  notifyOn: "BUY" | "SELL" | "HOLD" | "ANY";
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  channels: ("WEBHOOK" | "EMAIL" | "BROWSER_NOTIFICATION" | "IN_APP")[];
  lastTriggered?: number;
  triggerCount: number;
  cooldownPeriod: number; // milliseconds
}

export interface AlertEvent {
  id: string;
  alertId: string;
  symbol: string;
  type: string;
  message: string;
  timestamp: number;
  priority: AlertConfig["priority"];
  data: Record<string, unknown>;
}

export interface AlertSignal {
  symbol: string;
  signal: "BUY" | "SELL" | "HOLD";
  strength: number; // 0-100
  reason: string;
  timestamp: number;
  confidence: number; // 0-100
}

export class AlertManager {
  private alerts: Map<string, AlertConfig> = new Map();
  private eventHandlers: Map<string, (event: AlertEvent) => void> = new Map();
  private lastTriggered: Map<string, number> = new Map();

  addAlert(alert: AlertConfig): void {
    this.alerts.set(alert.id, alert);
  }

  removeAlert(alertId: string): boolean {
    return this.alerts.delete(alertId);
  }

  updateAlert(alertId: string, updates: Partial<AlertConfig>): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    this.alerts.set(alertId, { ...alert, ...updates });
    return true;
  }

  getAlerts(): AlertConfig[] {
    return Array.from(this.alerts.values());
  }

  getAlert(symbol: string): AlertConfig[] {
    return Array.from(this.alerts.values()).filter(
      (alert) => alert.symbol === symbol,
    );
  }

  on(event: string, handler: (event: AlertEvent) => void): void {
    this.eventHandlers.set(event, handler);
  }

  off(event: string): void {
    this.eventHandlers.delete(event);
  }

  private emitEvent(event: AlertEvent): void {
    this.eventHandlers.forEach((handler) => handler(event));
  }

  private checkCondition(
    alert: AlertConfig,
    currentValue: number,
    previousValue?: number,
  ): boolean {
    const { trigger } = alert;

    if (trigger.type === "PRICE" || trigger.type === "TECHNICAL") {
      switch (trigger.condition) {
        case "ABOVE":
          return currentValue > trigger.value;
        case "BELOW":
          return currentValue < trigger.value;
        case "EQUALS":
          return Math.abs(currentValue - trigger.value) < 0.0001;
        case "CROSSES_ABOVE":
          return (
            previousValue !== undefined &&
            previousValue <= trigger.value &&
            currentValue > trigger.value
          );
        case "CROSSES_BELOW":
          return (
            previousValue !== undefined &&
            previousValue >= trigger.value &&
            currentValue < trigger.value
          );
      }
    }

    return false;
  }

  evaluateAlert(
    symbol: string,
    data: {
      price?: number;
      rsi?: number;
      macd?: number;
      volume?: number;
      aiSignal?: AlertSignal;
    },
    previousData?: typeof data,
  ): void {
    const alerts = this.getAlert(symbol);

    for (const alert of alerts) {
      if (!alert.enabled) continue;

      const lastTriggered = this.lastTriggered.get(alert.id);
      if (lastTriggered && Date.now() - lastTriggered < alert.cooldownPeriod)
        continue;

      let triggered = false;
      let triggerMessage = "";
      let triggerType = "";

      // Price alerts
      if (data.price !== undefined && alert.trigger.type === "PRICE") {
        triggered = this.checkCondition(alert, data.price, previousData?.price);
        if (triggered) {
          triggerMessage = `${alert.trigger.condition === "ABOVE" ? "Acima" : "Abaixo"} de ${alert.trigger.value}`;
          triggerType = "PRICE";
        }
      }

      // Technical alerts
      if (
        !triggered &&
        data.rsi !== undefined &&
        alert.trigger.type === "TECHNICAL"
      ) {
        triggered = this.checkCondition(alert, data.rsi, previousData?.rsi);
        if (triggered) {
          triggerMessage = `RSI ${alert.trigger.condition === "ABOVE" ? "acima" : "abaixo"} de ${alert.trigger.value}`;
          triggerType = "TECHNICAL";
        }
      }

      // AI Signal alerts
      if (!triggered && data.aiSignal && alert.trigger.type === "AI_SIGNAL") {
        const matchesSignal =
          alert.notifyOn === data.aiSignal.signal || alert.notifyOn === "ANY";
        if (matchesSignal && data.aiSignal.strength >= alert.trigger.value) {
          triggered = true;
          triggerMessage = `Sinal ${data.aiSignal.signal} com força ${data.aiSignal.strength}%`;
          triggerType = "AI_SIGNAL";
        }
      }

      if (triggered) {
        const event: AlertEvent = {
          id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          alertId: alert.id,
          symbol,
          type: triggerType,
          message: triggerMessage,
          timestamp: Date.now(),
          priority: alert.priority,
          data: { ...data, alert },
        };

        this.emitEvent(event);
        this.lastTriggered.set(alert.id, Date.now());

        // Update trigger count
        alert.triggerCount++;
        this.alerts.set(alert.id, alert);
      }
    }
  }

  // Create predefined alert templates
  createPriceAlert(
    symbol: string,
    price: number,
    condition: "ABOVE" | "BELOW",
  ): AlertConfig {
    return {
      id: `price_${symbol}_${Date.now()}`,
      symbol,
      name: `Preço ${condition === "ABOVE" ? "acima" : "abaixo"} de $${price}`,
      trigger: {
        type: "PRICE",
        condition,
        value: price,
      },
      enabled: true,
      notifyOn: "ANY",
      priority: "MEDIUM",
      channels: ["IN_APP", "BROWSER_NOTIFICATION"],
      triggerCount: 0,
      cooldownPeriod: 5 * 60 * 1000, // 5 minutes
    };
  }

  createTechnicalAlert(
    symbol: string,
    indicator: "RSI",
    value: number,
    condition: "ABOVE" | "BELOW",
  ): AlertConfig {
    return {
      id: `tech_${symbol}_${indicator}_${Date.now()}`,
      symbol,
      name: `${indicator} ${condition === "ABOVE" ? "acima" : "abaixo"} de ${value}`,
      trigger: {
        type: "TECHNICAL",
        condition,
        value,
      },
      enabled: true,
      notifyOn: "ANY",
      priority: "MEDIUM",
      channels: ["IN_APP"],
      triggerCount: 0,
      cooldownPeriod: 10 * 60 * 1000, // 10 minutes
    };
  }

  createAISignalAlert(symbol: string, minStrength: number): AlertConfig {
    return {
      id: `ai_${symbol}_${Date.now()}`,
      symbol,
      name: `Sinal AI com força mínima ${minStrength}%`,
      trigger: {
        type: "AI_SIGNAL",
        condition: "ABOVE",
        value: minStrength,
      },
      enabled: true,
      notifyOn: "ANY",
      priority: "HIGH",
      channels: ["IN_APP", "WEBHOOK"],
      triggerCount: 0,
      cooldownPeriod: 2 * 60 * 1000, // 2 minutes
    };
  }

  // Smart alert combination for better signals
  createSmartAlert(symbol: string): AlertConfig {
    return {
      id: `smart_${symbol}_${Date.now()}`,
      symbol,
      name: "Alerta Inteligente Combinado",
      trigger: {
        type: "AI_SIGNAL",
        condition: "ABOVE",
        value: 75, // High confidence threshold
      },
      enabled: true,
      notifyOn: "BUY",
      priority: "URGENT",
      channels: ["IN_APP", "WEBHOOK", "BROWSER_NOTIFICATION"],
      triggerCount: 0,
      cooldownPeriod: 1 * 60 * 1000, // 1 minute
    };
  }
}

export const alertManager = new AlertManager();
