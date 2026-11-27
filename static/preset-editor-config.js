(() => {
  "use strict";

  const integerText = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });
  // 小さな数値と通常長のタグを含むSQLite行・索引の概算（1点あたり）。
  const roughSampleBytes = 160;
  const decimalText = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });

  function fieldSuggestions(spec, types) {
    const fields = spec?.generator?.fields;
    return Array.isArray(fields) ? fields.filter((field) => typeof field?.name === "string" && types.includes(field.data_type)).map((field) => field.name) : [];
  }

  function summarize(spec, preview) {
    const history = spec?.history;
    if (!history) return [];
    const summary = [];
    const tags = Array.isArray(history.tags) ? history.tags : [];
    const validDeviceCount = Number.isInteger(history.devices) && history.devices > 0;
    const perTick = validDeviceCount ? history.devices * tags.length : 0;
    if (perTick) {
      summary.push({ label: "設備別タグ数", value: integerText.format(perTick) + "（" + history.devices + "台 × " + tags.length + "項目）" });
      if (Number.isInteger(history.initial_samples) && history.initial_samples >= 0) {
        const initial = history.initial_samples * perTick;
        summary.push({ label: "初期点数（欠測前）", value: integerText.format(initial) + " 点" + (initial > 2000000 ? "（200万点の上限超過）" : "") });
      }
      if (Number.isInteger(history.initial_samples) && history.initial_samples > 0 &&
          !history.source_time_field && Number.isFinite(history.sample_seconds) && history.sample_seconds > 0 &&
          Number.isInteger(history.retention_days) && history.retention_days > 0) {
        const slotsWithinRetention = Math.floor(history.retention_days * 86400 / history.sample_seconds);
        const olderSlots = history.initial_samples - slotsWithinRetention;
        if (olderSlots > 0) {
          summary.push({ label: "初期履歴のうち保持期間外", value: "約 " + integerText.format(olderSlots * perTick) + " 点（欠測前）" });
        }
      }
      if (Number.isFinite(spec.interval_ms) && spec.interval_ms > 0) {
        const ticks = Math.floor(86400000 / spec.interval_ms);
        const missing = Number.isInteger(history.missing_every) && history.missing_every > 0
          ? Math.floor(ticks / history.missing_every)
          : 0;
        const perDay = (ticks - missing) * perTick;
        summary.push({ label: "1日連続動作時の追加点数", value: "約 " + integerText.format(perDay) + " 点（処理待ち・保持期間による削除の影響を除いた概算）" });
        summary.push({ label: "追加容量の目安", value: "約 " + decimalText.format(perDay * roughSampleBytes / 1048576) + " MiB/日（1点160バイトと仮定）" });
      }
    }
    if (Number.isFinite(history.sample_seconds) && history.sample_seconds > 0 && Number.isInteger(history.initial_samples)) {
      const hours = (history.sample_seconds * history.initial_samples) / 3600;
      summary.push({
        label: "初期履歴の時刻幅",
        value: history.source_time_field ? "生成項目 " + history.source_time_field + " の時刻を使用" : "約 " + decimalText.format(hours) + " 時間",
      });
    }
    const possibleTags = new Set(fieldSuggestions(spec, ["integer", "number", "decimal", "boolean"]));
    const duplicate = tags.length !== new Set(tags).size;
    const unknown = possibleTags.size ? tags.filter((tag) => !possibleTags.has(tag)).length : 0;
    if (duplicate || unknown) {
      summary.push({
        label: "タグ参照を確認",
        value: [duplicate && "同じ名前が複数行にあります", unknown && "数値・真偽値の生成項目にないタグ " + unknown + " 件"].filter(Boolean).join(" / "),
      });
    }
    if (tags.length && typeof tags[0] === "string" && tags[0]) {
      const tag = new URLSearchParams({ tag: "device-001." + tags[0] });
      summary.push({ label: "生データ取得例", value: "/source/history/raw?" + tag.toString() + "&limit=10" });
      const aggregate = new URLSearchParams({
        tag: "device-001." + tags[0],
        start: "2026-01-01T00:00:00Z",
        end: "2026-01-01T00:01:00Z",
        function: "mean",
        interval_seconds: "60",
        good_only: "true",
      });
      summary.push({ label: "1分平均の取得例", value: "/source/history/aggregate?" + aggregate.toString() });
    }
    if (Array.isArray(preview?.records) && tags.length) {
      const tag = tags[0];
      const series = preview.records.slice(0, 8).map((record) => record[tag] ?? "NULL");
      if (series.length) summary.push({ label: "生成見本の " + tag, value: series.join(" → ") });
    }
    return summary;
  }


  const types = [
    { value: "string", label: "文字列" },
    { value: "integer", label: "整数" },
    { value: "number", label: "実数" },
    { value: "decimal", label: "固定小数点" },
    { value: "boolean", label: "真偽値" },
    { value: "datetime", label: "日時" },
    { value: "json", label: "JSON" },
  ];
  const generators = [
    { value: "record_id", label: "決定的なレコードID" },
    { value: "uuid", label: "UUID" },
    { value: "sequence", label: "連番" },
    { value: "integer", label: "ランダム整数" },
    { value: "uniform", label: "一様分布" },
    { value: "normal", label: "正規分布" },
    { value: "choice", label: "候補から選択" },
    { value: "boolean", label: "確率で真偽値" },
    { value: "constant", label: "固定値" },
    { value: "template", label: "文字列ひな型" },
    { value: "timestamp", label: "時刻の連番" },
    { value: "reference", label: "前の項目を参照" },
    { value: "sum", label: "参照値の和" },
    { value: "difference", label: "参照値の差" },
    { value: "product", label: "参照値の積" },
    { value: "ratio", label: "参照値の比" },
  ];
  const anomalyOperations = [
    { value: "set", label: "値を置き換え" },
    { value: "add", label: "加算" },
    { value: "multiply", label: "倍率" },
    { value: "ramp", label: "連続的に増減" },
    { value: "freeze", label: "開始位置の値に固定" },
    { value: "null", label: "NULLを設定" },
    { value: "copy_from", label: "別位置からコピー" },
    { value: "timestamp_shift", label: "時刻をずらす" },
    { value: "omit", label: "項目を省略" },
  ];
  const generatorIs = (...equals) => ({ path: "generator", equals });
  const generatedFields = (spec) => Array.isArray(spec?.generator?.fields) ? spec.generator.fields : [];
  const fieldNames = (spec) => generatedFields(spec).flatMap((field) => typeof field?.name === "string" ? [field.name] : []);

  function newField(rows) {
    const names = new Set(rows.flatMap((row) => typeof row?.name === "string" ? [row.name.toLowerCase()] : []));
    let name = "measurement";
    let suffix = 2;
    while (names.has(name)) {
      name = "measurement_" + suffix;
      suffix += 1;
    }
    return { name, data_type: "number", generator: "constant", value: 0 };
  }

  function newAnomaly(_rows, spec) {
    const fields = generatedFields(spec);
    const numeric = fields.find((field) => !field?.primary_key && ["integer", "number", "decimal"].includes(field?.data_type));
    const first = numeric || fields.find((field) => field?.name && !field.primary_key) || fields.find((field) => field?.name);
    return {
      name: "異常注入",
      enabled: false,
      field: first?.name || "value",
      operation: numeric ? "add" : "null",
      value: numeric ? 1 : null,
      from_row: 0,
      every: 1,
      probability: 1,
    };
  }

  const generationSection = {
    title: "時系列の元になる生成項目",
    description: "数値・真偽値をタグとして選べます。日時項目は履歴を記録する時刻にも利用できます。",
    fields: [
      { path: "generator.seed", label: "乱数シード", type: "integer", min: 0, max: 2147483647, default: 42, help: "同じ条件とシードで同じ値を再現できます。" },
      { path: "generator.start_sequence", label: "生成順の開始値", type: "integer", min: 0, max: 1000000000, default: 0 },
      { path: "generator.parameters", label: "共通パラメーター", type: "json", default: {}, help: "JSONのオブジェクト。項目設定から文字列の $キー を使って値を参照できます。" },
      {
        path: "generator.fields",
        label: "生成項目",
        type: "table",
        min: 1,
        max: 100,
        default: newField,
        columns: [
          { path: "name", label: "項目名", type: "text", help: "半角英数字と _ を使います。先頭は英字か _ です。", placeholder: "measurement" },
          { path: "data_type", label: "型", type: "select", options: types, default: "string" },
          { path: "generator", label: "生成方法", type: "select", options: generators, default: "constant" },
          { path: "value", label: "固定値", type: "json", default: null, when: generatorIs("constant"), help: "文字列はダブルクォートで囲み、数値や true / false はそのまま入力します。" },
          { path: "minimum", label: "下限値", type: "json", default: 0, when: generatorIs("integer", "uniform"), help: "数値、または \"$パラメーター名\"。" },
          { path: "maximum", label: "上限値", type: "json", default: 100, when: generatorIs("integer", "uniform") },
          { path: "mean", label: "平均値", type: "json", default: 50, when: generatorIs("normal"), help: "数値、または \"$パラメーター名\"。" },
          { path: "stddev", label: "標準偏差", type: "json", default: 5, when: generatorIs("normal"), help: "0以上。大きいほどばらつきが広がります。" },
          { path: "start", label: "開始値・開始日時", type: "json", default: 0, when: generatorIs("sequence", "timestamp"), help: "日時にはタイムゾーン付き文字列か、その値を持つ \"$パラメーター名\" を指定します。" },
          { path: "step", label: "増分（日時は秒）", type: "json", default: 1, when: generatorIs("sequence", "timestamp") },
          { path: "group_size", label: "同じ値を続ける件数", type: "json", default: 1, when: generatorIs("sequence", "timestamp") },
          { path: "modulo", label: "繰り返すまでの段階数", type: "json", default: 0, when: generatorIs("sequence", "timestamp"), help: "0を指定すると繰り返しません。" },
          { path: "choices", label: "候補リスト", type: "json", default: [], when: generatorIs("choice"), placeholder: '["ok", "warning"]', help: "JSON配列、または配列を持つ \"$パラメーター名\"。" },
          { path: "weights", label: "候補ごとの重み", type: "json", default: [], when: generatorIs("choice"), placeholder: "[9, 1]", help: "空の配列なら同じ確率です。指定する場合は候補と同じ件数にします。" },
          { path: "probability", label: "true となる確率", type: "json", default: 0.5, when: generatorIs("boolean"), help: "0〜1、または \"$パラメーター名\"。" },
          { path: "template", label: "文字列ひな型", type: "text", default: "{sequence}", when: generatorIs("template"), help: "{項目名}、{sequence}、{record_id} などを展開します。" },
          { path: "sources", label: "参照項目（1行1項目）", type: "string-list", default: [], when: generatorIs("reference", "sum", "difference", "product", "ratio"), help: "表で先に定義した項目を指定します。比率は分子、分母の順です。" },
          { path: "length", label: "文字列の最大長", type: "integer", min: 1, max: 4000, default: 255, when: { path: "data_type", equals: "string" } },
          { path: "precision", label: "全体の精度（桁）", type: "integer", min: 1, max: 38, default: 18, when: { path: "data_type", equals: "decimal" } },
          { path: "scale", label: "小数部の桁数", type: "integer", min: 0, max: 18, default: 3, when: { path: "data_type", equals: "decimal" } },
          { path: "primary_key", label: "一意キー", type: "boolean", default: false, help: "一意キーにNULL率は指定できません。" },
          { path: "null_probability", label: "NULL率 (0〜1)", type: "number", min: 0, max: 1, step: "any", default: 0 },
          { path: "condition", label: "条件分岐（JSON）", type: "json", default: null, help: "他の項目の値に応じて生成値を差し替える詳細条件です。通常は null のままにします。" },
        ],
      },
    ],
  };

  const anomalySection = {
    title: "生成項目の異常シナリオ",
    description: "数値の急変・ドリフト・固定値や生成タイムスタンプのずれを作れます。時点そのものを欠測にする周期は履歴専用の設定で指定します。",
    fields: [
      {
        path: "generator.anomalies",
        label: "値の異常ルール",
        type: "table",
        max: 64,
        default: newAnomaly,
        columns: [
          { path: "name", label: "異常名", type: "text", default: "異常注入" },
          { path: "enabled", label: "適用する", type: "boolean", default: true },
          { path: "field", label: "対象項目", type: "text", suggestions: fieldNames },
          { path: "operation", label: "変更方法", type: "select", options: anomalyOperations, default: "set" },
          { path: "value", label: "置換値・変化量・コピー元", type: "json", default: null, when: { path: "operation", equals: ["set", "add", "multiply", "ramp", "copy_from", "timestamp_shift"] }, help: "加算・倍率は数値、コピー元は0から始まる行位置、時刻のずれは秒で指定します。" },
          { path: "from_row", label: "開始行（0始まり）", type: "integer", min: 0, max: 100000000, default: 0 },
          { path: "to_row", label: "最終行（省略は最後まで）", type: "json", default: null, help: "0以上の整数、または null。指定した行を含みます。" },
          { path: "every", label: "適用間隔（行）", type: "integer", min: 1, max: 100000000, default: 1 },
          { path: "probability", label: "適用確率 (0〜1)", type: "number", min: 0, max: 1, step: "any", default: 1 },
          { path: "when", label: "発生条件（JSON）", type: "json", default: null, help: "対象行を他の項目の値で絞り込みます。条件を付けない場合は null にします。" },
          { path: "bypass_validation", label: "型制約外の値も再現", type: "boolean", default: false, help: "取込側のエラー処理を確認する場合にのみ有効にします。" },
        ],
      },
    ],
  };

  window.FactoryPresetConfig = {
    title: "履歴タグとサンプリングの編集",
    description: "設備ごとの時系列にする項目、初期履歴、記録時刻、欠測・品質・保持期間を設定します。",
    summarize,
    sections: [
      {
        title: "取得用プロファイルと記録の上限",
        description: "履歴APIに使うプロファイルを選び、記録処理の間隔とアプリの容量上限を設定します。",
        fields: [
          { path: "profile_id", label: "履歴APIの公開プロファイル", type: "connection", default: "default", help: "履歴を取得する利用者の認証条件などを、保存済みの設定から選びます。" },
          { path: "interval_ms", label: "履歴追加処理の周期 (ms)", type: "integer", min: 10, max: 60000, default: 1000, help: "実際に追加処理を呼ぶ間隔です。記録時刻の進み方は「サンプル時刻の間隔」で決まります。" },
          { path: "max_ticks", label: "停止までの追加処理回数", type: "integer", min: 0, max: 100000000, default: 0, help: "0は回数無制限です。正の値は、初期履歴作成後の追加処理の回数です。" },
          { path: "storage_limit_mb", label: "アプリの保存領域上限 (MiB)", type: "integer", min: 16, max: 102400, default: 1024, help: "履歴を含むアプリ全体の上限です。保持期間は別の項目で指定し、古い点の整理に使います。" },
        ],
      },
      {
        title: "履歴に記録するタグ",
        description: "生成項目から数値・真偽値を選びます。保存時のタグ名は device-001.value のように設備ごとに付きます。",
        fields: [
          { path: "history.tags", label: "タグにする生成項目（1行1項目）", type: "string-list", min: 1, max: 100, default: ["value"], placeholder: "value", help: "同じ項目を複数行に入れると同名の履歴が作られます。" },
          { path: "history.devices", label: "設備台数", type: "integer", min: 1, max: 1000, default: 4 },
          { path: "history.initial_samples", label: "初回に作る過去の時点数", type: "integer", min: 0, max: 1000000, default: 1000, help: "時点数 × 設備台数 × タグ項目数の上限は200万点です。" },
        ],
      },
      {
        title: "サンプル時刻と保存期間",
        description: "画面上部の更新周期は処理の間隔です。このセクションでは履歴に記録する時刻と、実運転時の保持期間を設定します。",
        fields: [
          { path: "history.sample_seconds", label: "サンプル時刻の間隔 (秒)", type: "number", min: 0.01, max: 86400, step: "any", default: 1 },
          {
            path: "history.source_time_field",
            label: "記録時刻に使う生成項目",
            type: "text",
            default: "",
            placeholder: "例: event_time",
            suggestions: (spec) => fieldSuggestions(spec, ["datetime"]),
            help: "日時型の生成項目を選べます。空欄ではサンプル時刻の間隔から計算します。",
          },
          { path: "history.retention_days", label: "保持期間 (日)", type: "integer", min: 1, max: 3650, default: 90, help: "運転中、100 tickごとにこの期間より古い記録を整理します。" },
        ],
      },
      {
        title: "欠測・品質・時刻異常",
        description: "周期は時点数です。欠測はその時点の記録を省き、値がNULLのサンプルとは区別されます。",
        fields: [
          { path: "history.missing_every", label: "欠測にする間隔（時点ごと）", type: "integer", min: 0, default: 0, help: "0で無効。設備・タグすべての記録をその時点だけ省きます。" },
          { path: "history.bad_every", label: "品質を変更する間隔（時点ごと）", type: "integer", min: 0, default: 0, help: "0で無効。間隔ごとに下の品質を使います。" },
          {
            path: "history.quality", label: "変更する品質", type: "select", default: "Good",
            options: [
              { value: "Good", label: "正常 (Good)" },
              { value: "Bad", label: "不良 (Bad)" },
              { value: "Uncertain", label: "要確認 (Uncertain)" },
            ],
          },
          { path: "history.shift_every", label: "時刻をずらす間隔（時点ごと）", type: "integer", min: 0, default: 0, help: "0で無効。記録時刻に生成項目を選ぶと、その日時が優先されます。" },
          { path: "history.timestamp_shift_seconds", label: "時刻のずれ (秒)", type: "number", step: "any", default: 0, help: "負数で過去側にずらします。時系列外の到着や遅延を試せます。" },
        ],
      },
      generationSection,
      anomalySection,
    ],
  };
})();
