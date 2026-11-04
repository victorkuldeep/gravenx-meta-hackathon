/**
 * Validate workspace - explicitly labeled example contract + payload.
 * Offered only as an example; never confused with an uploaded spec.
 */

export const SAMPLE_FILE_NAME = "example-orders.json";

export const SAMPLE_SPEC = `{
  "openapi": "3.0.3",
  "info": { "title": "Example Orders API", "version": "1.0.0" },
  "paths": {
    "/orders": {
      "get": {
        "operationId": "listOrders",
        "summary": "List orders",
        "responses": {
          "200": {
            "description": "A page of orders",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "required": ["orders"],
                  "properties": {
                    "orders": { "type": "array", "items": { "$ref": "#/components/schemas/Order" } }
                  },
                  "additionalProperties": false
                }
              }
            }
          }
        }
      },
      "post": {
        "operationId": "createOrder",
        "summary": "Create an order",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/NewOrder" }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Order created",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Order" }
              }
            }
          },
          "400": { "description": "Invalid request" }
        }
      }
    },
    "/orders/{orderId}": {
      "get": {
        "operationId": "getOrder",
        "summary": "Get an order by id",
        "parameters": [
          { "name": "orderId", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": {
            "description": "The order",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Order" }
              }
            }
          },
          "404": { "description": "Not found" }
        }
      },
      "patch": {
        "operationId": "updateOrder",
        "summary": "Update an order's priority",
        "parameters": [
          { "name": "orderId", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["priority"],
                "properties": {
                  "priority": { "type": "string", "enum": ["standard", "express"] }
                },
                "additionalProperties": false
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Updated order",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Order" }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "Customer": {
        "type": "object",
        "required": ["email"],
        "properties": {
          "email": { "type": "string", "format": "email" },
          "priority": { "type": "string", "enum": ["standard", "express"], "nullable": true }
        },
        "additionalProperties": false
      },
      "OrderItem": {
        "type": "object",
        "required": ["sku", "quantity"],
        "properties": {
          "sku": { "type": "string", "minLength": 3 },
          "quantity": { "type": "integer", "minimum": 1 }
        },
        "additionalProperties": false
      },
      "NewOrder": {
        "type": "object",
        "required": ["customer", "items"],
        "properties": {
          "customer": { "$ref": "#/components/schemas/Customer" },
          "items": {
            "type": "array",
            "minItems": 1,
            "items": { "$ref": "#/components/schemas/OrderItem" }
          },
          "placedAt": { "type": "string", "format": "date-time" }
        },
        "additionalProperties": false
      },
      "Order": {
        "type": "object",
        "required": ["orderId", "status", "customer", "items"],
        "properties": {
          "orderId": { "type": "string", "readOnly": true },
          "status": { "type": "string", "enum": ["created", "queued"] },
          "customer": { "$ref": "#/components/schemas/Customer" },
          "items": {
            "type": "array",
            "items": { "$ref": "#/components/schemas/OrderItem" }
          }
        },
        "additionalProperties": false
      }
    }
  }
}`;

export const SAMPLE_PAYLOAD = `{
  "customer": {
    "email": "ada@example.com",
    "priority": null
  },
  "items": [
    { "sku": "WID-01", "quantity": 2 }
  ],
  "placedAt": "2026-09-27T10:00:00Z"
}`;
