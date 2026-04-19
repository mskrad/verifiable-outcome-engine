export const OUTCOME_IDL = {
  "address": "3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq",
  "metadata": {
    "name": "outcome",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Outcome-first deterministic runtime"
  },
  "instructions": [
    {
      "name": "admin_pause",
      "discriminator": [
        13,
        109,
        240,
        129,
        86,
        245,
        182,
        45
      ],
      "accounts": [
        {
          "name": "program_config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "outcome_config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "outcome_config.runtime_id",
                "account": "OutcomeConfig"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "admin_withdraw",
      "discriminator": [
        160,
        166,
        147,
        222,
        46,
        220,
        75,
        224
      ],
      "accounts": [
        {
          "name": "outcome_config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "outcome_config.runtime_id",
                "account": "OutcomeConfig"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "outcome_config"
          ]
        },
        {
          "name": "outcome_vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "outcome_config.runtime_id",
                "account": "OutcomeConfig"
              }
            ]
          }
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "lamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "finalize_compiled_artifact",
      "discriminator": [
        133,
        66,
        77,
        26,
        133,
        31,
        143,
        150
      ],
      "accounts": [
        {
          "name": "publisher",
          "signer": true
        },
        {
          "name": "approved_outcome_artifact",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "init_compiled_artifact_chunk",
      "discriminator": [
        36,
        212,
        98,
        81,
        183,
        15,
        66,
        243
      ],
      "accounts": [
        {
          "name": "publisher",
          "writable": true,
          "signer": true
        },
        {
          "name": "approved_outcome_artifact",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  112,
                  112,
                  114,
                  111,
                  118,
                  101,
                  100,
                  95,
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  97,
                  114,
                  116,
                  105,
                  102,
                  97,
                  99,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "args.compiled_artifact_hash"
              }
            ]
          }
        },
        {
          "name": "approved_outcome_artifact_chunk",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  112,
                  112,
                  114,
                  111,
                  118,
                  101,
                  100,
                  95,
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  97,
                  114,
                  116,
                  105,
                  102,
                  97,
                  99,
                  116,
                  95,
                  99,
                  104,
                  117,
                  110,
                  107
                ]
              },
              {
                "kind": "arg",
                "path": "args.compiled_artifact_hash"
              },
              {
                "kind": "arg",
                "path": "args.chunk_index"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "InitCompiledArtifactChunkArgs"
            }
          }
        }
      ]
    },
    {
      "name": "initialize_outcome_config",
      "discriminator": [
        140,
        236,
        44,
        107,
        18,
        47,
        130,
        218
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "program_config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "outcome_config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "arg",
                "path": "args.runtime_id"
              }
            ]
          }
        },
        {
          "name": "outcome_vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "args.runtime_id"
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "approved_outcome_artifact",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  112,
                  112,
                  114,
                  111,
                  118,
                  101,
                  100,
                  95,
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  97,
                  114,
                  116,
                  105,
                  102,
                  97,
                  99,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "args.compiled_artifact_hash"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "InitializeOutcomeConfigArgs"
            }
          }
        }
      ]
    },
    {
      "name": "initialize_program_config",
      "discriminator": [
        6,
        131,
        61,
        237,
        40,
        110,
        83,
        124
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "program_config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "InitializeProgramConfigArgs"
            }
          }
        }
      ]
    },
    {
      "name": "refresh_master_seed",
      "discriminator": [
        217,
        245,
        210,
        23,
        62,
        147,
        246,
        173
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "program_config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "outcome_config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "arg",
                "path": "args.runtime_id"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "RefreshMasterSeedArgs"
            }
          }
        }
      ]
    },
    {
      "name": "resolve_outcome",
      "discriminator": [
        163,
        82,
        25,
        106,
        219,
        103,
        143,
        14
      ],
      "accounts": [
        {
          "name": "actor",
          "writable": true,
          "signer": true
        },
        {
          "name": "program_config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "outcome_config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "arg",
                "path": "args.runtime_id"
              }
            ]
          }
        },
        {
          "name": "outcome_vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "args.runtime_id"
              }
            ]
          }
        },
        {
          "name": "outcome_resolution",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  114,
                  101,
                  115,
                  111,
                  108,
                  117,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "args.runtime_id"
              },
              {
                "kind": "account",
                "path": "outcome_config.next_resolve_id",
                "account": "OutcomeConfig"
              }
            ]
          }
        },
        {
          "name": "approved_outcome_artifact",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  112,
                  112,
                  114,
                  111,
                  118,
                  101,
                  100,
                  95,
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  97,
                  114,
                  116,
                  105,
                  102,
                  97,
                  99,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "outcome_config.compiled_artifact_hash",
                "account": "OutcomeConfig"
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "ResolveOutcomeArgs"
            }
          }
        }
      ]
    },
    {
      "name": "review_compiled_artifact",
      "discriminator": [
        240,
        75,
        98,
        202,
        198,
        104,
        47,
        244
      ],
      "accounts": [
        {
          "name": "program_config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "approved_outcome_artifact",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "ReviewCompiledArtifactArgs"
            }
          }
        }
      ]
    },
    {
      "name": "set_program_config",
      "discriminator": [
        239,
        199,
        221,
        154,
        79,
        241,
        140,
        123
      ],
      "accounts": [
        {
          "name": "program_config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "SetProgramConfigArgs"
            }
          }
        }
      ]
    },
    {
      "name": "submit_compiled_artifact",
      "discriminator": [
        145,
        16,
        134,
        179,
        37,
        180,
        0,
        230
      ],
      "accounts": [
        {
          "name": "publisher",
          "writable": true,
          "signer": true
        },
        {
          "name": "approved_outcome_artifact",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  112,
                  112,
                  114,
                  111,
                  118,
                  101,
                  100,
                  95,
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  97,
                  114,
                  116,
                  105,
                  102,
                  97,
                  99,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "args.compiled_artifact_hash"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "SubmitCompiledArtifactArgs"
            }
          }
        }
      ]
    },
    {
      "name": "write_compiled_artifact_chunk",
      "discriminator": [
        76,
        137,
        250,
        147,
        225,
        154,
        80,
        199
      ],
      "accounts": [
        {
          "name": "publisher",
          "signer": true
        },
        {
          "name": "approved_outcome_artifact",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  112,
                  112,
                  114,
                  111,
                  118,
                  101,
                  100,
                  95,
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  97,
                  114,
                  116,
                  105,
                  102,
                  97,
                  99,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "args.compiled_artifact_hash"
              }
            ]
          }
        },
        {
          "name": "approved_outcome_artifact_chunk",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  112,
                  112,
                  114,
                  111,
                  118,
                  101,
                  100,
                  95,
                  111,
                  117,
                  116,
                  99,
                  111,
                  109,
                  101,
                  95,
                  97,
                  114,
                  116,
                  105,
                  102,
                  97,
                  99,
                  116,
                  95,
                  99,
                  104,
                  117,
                  110,
                  107
                ]
              },
              {
                "kind": "arg",
                "path": "args.compiled_artifact_hash"
              },
              {
                "kind": "arg",
                "path": "args.chunk_index"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "WriteCompiledArtifactChunkArgs"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "ApprovedOutcomeArtifact",
      "discriminator": [
        110,
        158,
        83,
        35,
        113,
        203,
        146,
        35
      ]
    },
    {
      "name": "ApprovedOutcomeArtifactChunk",
      "discriminator": [
        172,
        72,
        71,
        77,
        233,
        238,
        194,
        12
      ]
    },
    {
      "name": "OutcomeConfig",
      "discriminator": [
        140,
        119,
        82,
        148,
        43,
        47,
        24,
        122
      ]
    },
    {
      "name": "OutcomeResolution",
      "discriminator": [
        117,
        184,
        192,
        23,
        132,
        189,
        98,
        178
      ]
    },
    {
      "name": "ProgramConfig",
      "discriminator": [
        196,
        210,
        90,
        231,
        144,
        149,
        140,
        63
      ]
    }
  ],
  "events": [
    {
      "name": "MasterSeedRefreshedV1",
      "discriminator": [
        82,
        70,
        177,
        76,
        237,
        62,
        237,
        181
      ]
    },
    {
      "name": "OutcomeConfigInitializedV1",
      "discriminator": [
        59,
        61,
        45,
        109,
        164,
        166,
        216,
        245
      ]
    },
    {
      "name": "OutcomeResolveStartedV1",
      "discriminator": [
        0,
        32,
        7,
        122,
        63,
        44,
        96,
        94
      ]
    },
    {
      "name": "OutcomeResolvedV1",
      "discriminator": [
        72,
        217,
        204,
        203,
        233,
        185,
        165,
        67
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "InvalidInputAmount",
      "msg": "Invalid input amount"
    },
    {
      "code": 6001,
      "name": "RuntimePaused",
      "msg": "Runtime is paused"
    },
    {
      "code": 6002,
      "name": "Unauthorized",
      "msg": "Unauthorized"
    },
    {
      "code": 6003,
      "name": "UnauthorizedAdmin",
      "msg": "Unauthorized admin"
    },
    {
      "code": 6004,
      "name": "InvalidCompiledArtifactFormat",
      "msg": "Invalid compiled artifact format"
    },
    {
      "code": 6005,
      "name": "InvalidCompiledArtifactHash",
      "msg": "Invalid compiled artifact hash"
    },
    {
      "code": 6006,
      "name": "InvalidCompiledArtifactStatus",
      "msg": "Invalid compiled artifact status"
    },
    {
      "code": 6007,
      "name": "CompiledArtifactNotFinalized",
      "msg": "Compiled artifact is not finalized"
    },
    {
      "code": 6008,
      "name": "UnapprovedCompiledArtifact",
      "msg": "Compiled artifact is not approved for runtime binding"
    },
    {
      "code": 6009,
      "name": "InvalidArtifactUri",
      "msg": "Invalid artifact uri"
    },
    {
      "code": 6010,
      "name": "MissingArtifactChunk",
      "msg": "Missing compiled artifact chunk"
    },
    {
      "code": 6011,
      "name": "InvalidArtifactChunkPda",
      "msg": "Invalid compiled artifact chunk PDA"
    },
    {
      "code": 6012,
      "name": "InvalidArtifactChunkCount",
      "msg": "Invalid compiled artifact chunk count"
    },
    {
      "code": 6013,
      "name": "BlobNotFullyWritten",
      "msg": "Compiled artifact blob not fully written"
    },
    {
      "code": 6014,
      "name": "InvalidChunkWrite",
      "msg": "Invalid chunk write"
    },
    {
      "code": 6015,
      "name": "InvalidOutcomeId",
      "msg": "Invalid outcome id"
    },
    {
      "code": 6016,
      "name": "InvalidEffectType",
      "msg": "Invalid effect type"
    },
    {
      "code": 6017,
      "name": "InvalidReservedBytes",
      "msg": "Invalid reserved bytes"
    },
    {
      "code": 6018,
      "name": "MathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6019,
      "name": "ArtifactBindingMismatch",
      "msg": "Artifact binding mismatch"
    },
    {
      "code": 6020,
      "name": "InvalidTreasuryAccount",
      "msg": "Invalid treasury account"
    }
  ],
  "types": [
    {
      "name": "ApprovedOutcomeArtifact",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "compiled_artifact_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "is_finalized",
            "type": "bool"
          },
          {
            "name": "format_version",
            "type": "u16"
          },
          {
            "name": "blob_len",
            "type": "u32"
          },
          {
            "name": "chunk_count",
            "type": "u16"
          },
          {
            "name": "artifact_uri_len",
            "type": "u16"
          },
          {
            "name": "artifact_uri",
            "type": {
              "array": [
                "u8",
                200
              ]
            }
          },
          {
            "name": "audit_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "created_at",
            "type": "i64"
          },
          {
            "name": "updated_at",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                31
              ]
            }
          }
        ]
      }
    },
    {
      "name": "ApprovedOutcomeArtifactChunk",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "compiled_artifact_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "chunk_index",
            "type": "u32"
          },
          {
            "name": "written_len",
            "type": "u16"
          },
          {
            "name": "data",
            "type": {
              "array": [
                "u8",
                1024
              ]
            }
          }
        ]
      }
    },
    {
      "name": "InitCompiledArtifactChunkArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "compiled_artifact_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "chunk_index",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "InitializeOutcomeConfigArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "runtime_id",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "min_input_lamports",
            "type": "u64"
          },
          {
            "name": "max_input_lamports",
            "type": "u64"
          },
          {
            "name": "compiled_artifact_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "master_seed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "InitializeProgramConfigArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "MasterSeedRefreshedV1",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "runtime_id",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "master_seed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "source_slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "OutcomeConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "runtime_id",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "min_input_lamports",
            "type": "u64"
          },
          {
            "name": "max_input_lamports",
            "type": "u64"
          },
          {
            "name": "next_resolve_id",
            "type": "u64"
          },
          {
            "name": "is_paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vault_bump",
            "type": "u8"
          },
          {
            "name": "compiled_artifact_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "master_seed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "last_seed_slot",
            "type": "u64"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                63
              ]
            }
          }
        ]
      }
    },
    {
      "name": "OutcomeConfigInitializedV1",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "runtime_id",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "min_input_lamports",
            "type": "u64"
          },
          {
            "name": "max_input_lamports",
            "type": "u64"
          },
          {
            "name": "compiled_artifact_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "OutcomeResolution",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "runtime_id",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "resolve_id",
            "type": "u64"
          },
          {
            "name": "actor",
            "type": "pubkey"
          },
          {
            "name": "input_lamports",
            "type": "u64"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "total_output_lamports",
            "type": "u64"
          },
          {
            "name": "compiled_artifact_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "randomness",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "outcome_id_len",
            "type": "u8"
          },
          {
            "name": "outcome_id",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "effect_count",
            "type": "u16"
          },
          {
            "name": "effects_digest",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                31
              ]
            }
          }
        ]
      }
    },
    {
      "name": "OutcomeResolveStartedV1",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "runtime_id",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "resolve_id",
            "type": "u64"
          },
          {
            "name": "actor",
            "type": "pubkey"
          },
          {
            "name": "input_lamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "OutcomeResolvedV1",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "runtime_id",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "resolve_id",
            "type": "u64"
          },
          {
            "name": "actor",
            "type": "pubkey"
          },
          {
            "name": "input_lamports",
            "type": "u64"
          },
          {
            "name": "total_output_lamports",
            "type": "u64"
          },
          {
            "name": "master_seed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "randomness",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "compiled_artifact_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "outcome_id_len",
            "type": "u8"
          },
          {
            "name": "outcome_id",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "effect_count",
            "type": "u16"
          },
          {
            "name": "effects_digest",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "ProgramConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "allow_unreviewed_binding",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                62
              ]
            }
          }
        ]
      }
    },
    {
      "name": "RefreshMasterSeedArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "runtime_id",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "new_master_seed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "ResolveOutcomeArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "runtime_id",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "input_lamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ReviewCompiledArtifactArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "audit_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "artifact_uri",
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "SetProgramConfigArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "new_admin",
            "type": "pubkey"
          },
          {
            "name": "allow_unreviewed_binding",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "SubmitCompiledArtifactArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "compiled_artifact_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "format_version",
            "type": "u16"
          },
          {
            "name": "blob_len",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "WriteCompiledArtifactChunkArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "compiled_artifact_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "chunk_index",
            "type": "u32"
          },
          {
            "name": "offset",
            "type": "u16"
          },
          {
            "name": "data",
            "type": "bytes"
          }
        ]
      }
    }
  ]
} as const;
