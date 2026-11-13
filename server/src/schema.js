// Collection layout for the TerraNova database. Mirrors database/terranova-setup.js.
// TABLES: how each collection maps to the row shape the rest of the server uses.
//   id     = the field the row calls its key (stored in MongoDB as _id)
//   auto   = numeric ids handed out by the server (see db.nextIds)
//   dates  = fields kept as real BSON dates in MongoDB, as epoch milliseconds in the server
//   bools  = fields kept as true/false in MongoDB
const TABLES = {
  "users": {
    "id": "id",
    "dates": [],
    "bools": [
      "pref_email",
      "pref_sms",
      "pref_push"
    ],
    "auto": true
  },
  "settings": {
    "id": "key"
  },
  "team": {
    "id": "email"
  },
  "invites": {
    "id": "token_hash",
    "dates": [
      "created_at",
      "expires_at",
      "used_at"
    ]
  },
  "plots": {
    "id": "id",
    "dates": [
      "moisture_at"
    ]
  },
  "sensors": {
    "id": "id",
    "dates": [
      "last_seen"
    ]
  },
  "readings": {
    "id": "id",
    "auto": true,
    "dates": [
      "ts"
    ]
  },
  "irrigation": {
    "id": "id",
    "auto": true,
    "dates": [
      "scheduled_for",
      "started_at",
      "completed_at",
      "created_at"
    ]
  },
  "alerts": {
    "id": "id",
    "auto": true,
    "dates": [
      "opened_at",
      "ack_at",
      "resolved_at"
    ]
  },
  "rec_state": {
    "id": "rec_key",
    "dates": [
      "until"
    ]
  },
  "audit": {
    "id": "id",
    "auto": true,
    "dates": [
      "ts"
    ]
  }
}

const VALIDATORS = {
  "users": {
    "$jsonSchema": {
      "bsonType": "object",
      "required": [
        "login_email",
        "password_hash",
        "role",
        "name",
        "title",
        "contact_email",
        "phone",
        "estate",
        "since"
      ],
      "properties": {
        "login_email": {
          "bsonType": "string"
        },
        "password_hash": {
          "bsonType": "string"
        },
        "role": {
          "enum": [
            "admin",
            "user"
          ]
        },
        "name": {
          "bsonType": "string"
        },
        "title": {
          "bsonType": "string"
        },
        "contact_email": {
          "bsonType": "string"
        },
        "phone": {
          "bsonType": "string"
        },
        "estate": {
          "bsonType": "string"
        },
        "since": {
          "bsonType": "string"
        },
        "pref_email": {
          "bsonType": "bool"
        },
        "pref_sms": {
          "bsonType": "bool"
        },
        "pref_push": {
          "bsonType": "bool"
        },
        "token_version": {
          "bsonType": [
            "int",
            "long",
            "double"
          ]
        }
      }
    }
  },
  "settings": {
    "$jsonSchema": {
      "bsonType": "object",
      "required": [
        "value"
      ],
      "properties": {
        "value": {
          "bsonType": "string"
        }
      }
    }
  },
  "team": {
    "$jsonSchema": {
      "bsonType": "object",
      "required": [
        "name",
        "role",
        "status",
        "access",
        "pos"
      ],
      "properties": {
        "name": {
          "bsonType": "string"
        },
        "role": {
          "bsonType": "string"
        },
        "status": {
          "enum": [
            "Active",
            "Invited"
          ]
        },
        "access": {
          "enum": [
            "admin",
            "user"
          ]
        },
        "pos": {
          "bsonType": [
            "int",
            "long",
            "double"
          ]
        }
      }
    }
  },
  "invites": {
    "$jsonSchema": {
      "bsonType": "object",
      "required": [
        "email",
        "name",
        "job_role",
        "access",
        "created_at",
        "expires_at"
      ],
      "properties": {
        "email": {
          "bsonType": "string"
        },
        "name": {
          "bsonType": "string"
        },
        "job_role": {
          "bsonType": "string"
        },
        "access": {
          "enum": [
            "admin",
            "user"
          ]
        },
        "created_at": {
          "bsonType": "date"
        },
        "expires_at": {
          "bsonType": "date"
        },
        "used_at": {
          "bsonType": [
            "date",
            "null"
          ]
        }
      }
    }
  },
  "plots": {
    "$jsonSchema": {
      "bsonType": "object",
      "required": [
        "name",
        "area",
        "crop",
        "age",
        "ndvi",
        "pos"
      ],
      "properties": {
        "name": {
          "bsonType": "string"
        },
        "area": {
          "bsonType": [
            "int",
            "long",
            "double"
          ]
        },
        "crop": {
          "bsonType": "string"
        },
        "age": {
          "bsonType": [
            "int",
            "long",
            "double"
          ]
        },
        "ndvi": {
          "bsonType": [
            "int",
            "long",
            "double"
          ]
        },
        "moisture": {
          "bsonType": [
            "int",
            "long",
            "double",
            "null"
          ]
        },
        "moisture_at": {
          "bsonType": [
            "date",
            "null"
          ]
        },
        "pos": {
          "bsonType": [
            "int",
            "long",
            "double"
          ]
        }
      }
    }
  },
  "sensors": {
    "$jsonSchema": {
      "bsonType": "object",
      "required": [
        "depth",
        "firmware",
        "signal",
        "battery",
        "pos"
      ],
      "properties": {
        "plot_id": {
          "bsonType": [
            "string",
            "null"
          ]
        },
        "depth": {
          "bsonType": "string"
        },
        "firmware": {
          "bsonType": "string"
        },
        "signal": {
          "bsonType": "string"
        },
        "battery": {
          "bsonType": [
            "int",
            "long",
            "double"
          ],
          "minimum": 0,
          "maximum": 100
        },
        "last_seen": {
          "bsonType": [
            "date",
            "null"
          ]
        },
        "moisture": {
          "bsonType": [
            "int",
            "long",
            "double",
            "null"
          ]
        },
        "temp": {
          "bsonType": [
            "int",
            "long",
            "double",
            "null"
          ]
        },
        "ec": {
          "bsonType": [
            "int",
            "long",
            "double",
            "null"
          ]
        },
        "ph": {
          "bsonType": [
            "int",
            "long",
            "double",
            "null"
          ]
        },
        "pos": {
          "bsonType": [
            "int",
            "long",
            "double"
          ]
        }
      }
    }
  },
  "readings": {
    "$jsonSchema": {
      "bsonType": "object",
      "required": [
        "source",
        "ts"
      ],
      "properties": {
        "plot_id": {
          "bsonType": [
            "string",
            "null"
          ]
        },
        "sensor_id": {
          "bsonType": [
            "string",
            "null"
          ]
        },
        "source": {
          "bsonType": "string"
        },
        "ts": {
          "bsonType": "date"
        },
        "moisture": {
          "bsonType": [
            "int",
            "long",
            "double",
            "null"
          ]
        },
        "temp": {
          "bsonType": [
            "int",
            "long",
            "double",
            "null"
          ]
        },
        "ec": {
          "bsonType": [
            "int",
            "long",
            "double",
            "null"
          ]
        },
        "ph": {
          "bsonType": [
            "int",
            "long",
            "double",
            "null"
          ]
        }
      }
    }
  },
  "irrigation": {
    "$jsonSchema": {
      "bsonType": "object",
      "required": [
        "plot_id",
        "kind",
        "mm",
        "litres",
        "status",
        "scheduled_for",
        "created_by",
        "created_at"
      ],
      "properties": {
        "plot_id": {
          "bsonType": "string"
        },
        "kind": {
          "bsonType": "string"
        },
        "mm": {
          "bsonType": [
            "int",
            "long",
            "double"
          ]
        },
        "litres": {
          "bsonType": [
            "int",
            "long",
            "double"
          ]
        },
        "note": {
          "bsonType": "string"
        },
        "status": {
          "bsonType": "string"
        },
        "scheduled_for": {
          "bsonType": "date"
        },
        "started_at": {
          "bsonType": [
            "date",
            "null"
          ]
        },
        "completed_at": {
          "bsonType": [
            "date",
            "null"
          ]
        },
        "created_by": {
          "bsonType": "string"
        },
        "created_at": {
          "bsonType": "date"
        },
        "rec_key": {
          "bsonType": [
            "string",
            "null"
          ]
        }
      }
    }
  },
  "alerts": {
    "$jsonSchema": {
      "bsonType": "object",
      "required": [
        "kind",
        "subject",
        "severity",
        "message",
        "status",
        "opened_at"
      ],
      "properties": {
        "kind": {
          "bsonType": "string"
        },
        "subject": {
          "bsonType": "string"
        },
        "severity": {
          "bsonType": "string"
        },
        "message": {
          "bsonType": "string"
        },
        "status": {
          "bsonType": "string"
        },
        "opened_at": {
          "bsonType": "date"
        },
        "ack_by": {
          "bsonType": [
            "string",
            "null"
          ]
        },
        "ack_at": {
          "bsonType": [
            "date",
            "null"
          ]
        },
        "resolved_at": {
          "bsonType": [
            "date",
            "null"
          ]
        }
      }
    }
  },
  "rec_state": {
    "$jsonSchema": {
      "bsonType": "object",
      "required": [
        "state",
        "until",
        "by"
      ],
      "properties": {
        "state": {
          "bsonType": "string"
        },
        "until": {
          "bsonType": "date"
        },
        "by": {
          "bsonType": "string"
        }
      }
    }
  },
  "audit": {
    "$jsonSchema": {
      "bsonType": "object",
      "required": [
        "ts",
        "user_name",
        "action"
      ],
      "properties": {
        "ts": {
          "bsonType": "date"
        },
        "user_id": {
          "bsonType": [
            "int",
            "long",
            "double",
            "null"
          ]
        },
        "user_name": {
          "bsonType": "string"
        },
        "action": {
          "bsonType": "string"
        },
        "detail": {
          "bsonType": "string"
        }
      }
    }
  }
}

const INDEXES = {
  "users": [
    [
      {
        "login_email": 1
      },
      {
        "unique": true,
        "name": "uniq_login_email"
      }
    ]
  ],
  "readings": [
    [
      { "ts": 1 },
      { "name": "ttl_readings_30d", "expireAfterSeconds": 2592000 }
    ],
    [
      {
        "plot_id": 1,
        "ts": 1
      },
      {
        "name": "idx_readings_plot"
      }
    ],
    [
      {
        "sensor_id": 1,
        "ts": 1
      },
      {
        "name": "idx_readings_sensor"
      }
    ]
  ],
  "irrigation": [
    [
      {
        "plot_id": 1,
        "scheduled_for": 1
      },
      {
        "name": "idx_irrigation_plot"
      }
    ],
    [
      {
        "status": 1
      },
      {
        "name": "idx_irrigation_status"
      }
    ]
  ],
  "alerts": [
    [
      {
        "status": 1,
        "opened_at": 1
      },
      {
        "name": "idx_alerts_status"
      }
    ]
  ],
  "sensors": [
    [
      {
        "plot_id": 1
      },
      {
        "name": "idx_sensors_plot"
      }
    ]
  ],
  "audit": [
    [
      {
        "ts": -1
      },
      {
        "name": "idx_audit_ts"
      }
    ]
  ],
  "invites": [
    [
      {
        "email": 1
      },
      {
        "name": "idx_invites_email"
      }
    ],
    [
      { "expires_at": 1 },
      { "name": "ttl_invites_expired", "expireAfterSeconds": 0 }
    ]
  ]
}

// Read-only database views: ready-made joined/aggregated "tables" that show up in Compass next to the collections.
// They are computed by MongoDB on every read, so they are always in step with the real data.
const VIEWS = {
  // every plot with its sensor count and average battery (a $lookup join)
  v_plot_overview: { viewOn: 'plots', pipeline: [
    { $lookup: { from: 'sensors', localField: '_id', foreignField: 'plot_id', as: 's' } },
    { $addFields: { sensor_count: { $size: '$s' }, avg_battery: { $round: [{ $avg: '$s.battery' }, 0] } } },
    { $project: { s: 0 } },
    { $sort: { pos: 1 } },
  ] },
  // litres applied per plot per day (a $group over completed irrigation events)
  v_water_use_daily: { viewOn: 'irrigation', pipeline: [
    { $match: { status: 'completed' } },
    { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$completed_at' } }, plot_id: '$plot_id' }, litres: { $sum: '$litres' }, events: { $sum: 1 } } },
    { $project: { _id: 0, day: '$_id.day', plot_id: '$_id.plot_id', litres: 1, events: 1 } },
    { $sort: { day: -1, plot_id: 1 } },
  ] },
  // alerts that still need attention, newest first
  v_open_alerts: { viewOn: 'alerts', pipeline: [
    { $match: { status: { $ne: 'resolved' } } },
    { $sort: { opened_at: -1 } },
    { $project: { kind: 1, subject: 1, severity: 1, message: 1, status: 1, opened_at: 1 } },
  ] },
}

module.exports = { TABLES, VALIDATORS, INDEXES, VIEWS, ORDER: Object.keys(TABLES) }
