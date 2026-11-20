# Dokploy配置・任意プロキシの手順

この手順は専用の検証環境向けです。既存環境の変更、外部公開、デプロイは自動では行いません。
対象は `factory-historian-simulator`、Composeサービスは `app`、コンテナー内HTTPポートは **8080** です。

## 先に確認すること

- 管理UI、`/api/*`、`/healthz`、`/metrics` はログイン認証を持ちません。TLSだけでは保護できません。既定のホスト公開はループバックのみです。
- `compose.yaml` はJSONとしても読める形式を維持しています。Dockerfile、アプリ、既存の実行時環境変数、セキュリティ制限は変更していません。
- `historian` アプリの通常経路はデータを生成してクライアントへ提供するサーバーです。共通モジュール内に別アプリ用HTTP送信処理があっても、このアプリへ実行時プロキシを一括注入しません。
- 名前付きボリューム `app-data` を `/data` へ接続します。設定DBと `source.key`、接続設定等を保持するため、バックアップは組で扱い、Gitへ入れません。プロジェクト名を変えると別ボリュームになります。
- 既定では最初の起動時に `AUTO_START=1` で生成を開始します。初回検証は新規ボリュームと `AUTO_START=0` を使います。既存ボリュームに保存された開始状態は別に復元されるため、変数だけで停止を保証しません。
- メモリー余裕6GiB、ディスク余裕等の保護条件があります。起動できないときは資源を確認し、保護機能を無効にして回避しないでください。
- 外部クライアントへ提供する `/source/*` の認証設定は管理UIの認証とは別です。

## プロキシを3つの段階に分ける

|段階|設定場所|この変更の範囲|
|---|---|---|
|ベースイメージ取得・レジストリー認証|Docker daemon / 使用するBuildKit builder|管理者が別途構成。Compose build argsだけでは解決しない|
|Dockerfileの `RUN pip install`|Compose `build.args`|任意の標準6変数をビルダーへ渡す|
|起動後のアプリ通信|必要なクライアント経路だけ|このアプリには一括追加しない|

`.env.example` の6変数はコメントアウトした任意設定例です。既定では未指定なので既存のDockerクライアント設定を上書きしません。必要な場合のみ6行のコメントを外して上下を揃えて設定します。HTTP/HTTPSの空欄を有効にするとクライアントの既存設定を上書きし得るため、コメントのまま（未指定）とは異なります。NO_PROXYはループバック例です。
実際の `.env` はGit・Dockerビルドコンテキストから除外済みです。シェル変数は `.env` より優先するので、古い設定が残っていないか値を表示せず確認してください。
6変数を完全に未設定にした場合、名前のみの `build.args` は値を強制しません。Dockerクライアント側の既存プロキシ設定が適用される可能性は残ります。

認証情報を含まない記入例（値はダミー、接続先として使用しない）:

```dotenv
HTTP_PROXY=http://proxy.example.invalid:8080
HTTPS_PROXY=http://proxy.example.invalid:8080
NO_PROXY=localhost,127.0.0.1,::1
http_proxy=http://proxy.example.invalid:8080
https_proxy=http://proxy.example.invalid:8080
no_proxy=localhost,127.0.0.1,::1
```

上下の値は揃えます。HTTPS_PROXYはHTTPS宛て通信で使うプロキシで、例のプロキシURL自体はHTTPです。
Dockerの標準proxy build argsはDockerfileでARG/ENV宣言せず利用します。追加のARG/ENVやコマンド行への値埋め込みはしません。
ビルドツールのエラー出力には接続先が出る場合があるため、ログを公開しないでください。認証付きプロキシを共有`.env`、Git、スクリーンショットへ保存しません。

## Dokployの設定

1. 専用Project/Environment内で **Docker Compose** サービスを作成します。Stackは `build` を扱わないので選びません。
2. Gitソースにこのリポジトリ、検証済みブランチ/コミットを指定し、Compose Pathを `./compose.yaml` とします。最初はAuto Deployを無効にして手動で確認します。
3. Environmentに `BIND_IP=127.0.0.1`、`APP_PORT=3642`、`AUTO_START=0` を設定します。ホストのポート重複を事前確認してください。必要時だけ6つのproxy変数を設定します。Dokployは`.env`を用意しますが、変数が自動ですべてコンテナーに入るわけではありません。`env_file`で全投入しないでください。
4. `app-data:/data` の永続化、バックアップ先と復元手順、必要資源を確認します。Git checkout内のファイルを永続データ保存先にしません。
5. 最初はDomainsを作らず、Dockerホスト上のループバックからヘルスチェックします。別PCからは管理されたSSHトンネル等を使います。ローカルPCのlocalhostはDockerホストではありません。
6. Build/Deployの操作は配置先・新規ボリュームを確認した運用者が実行します。ログでビルド、ヘルスチェック、資源ガードの結果を確認し、生成開始はUIで別途判断します。
7. 外部URLが本当に必要な場合のみ、アクセス制御・認証・TLSを先に設計します。Domainsの対象は `app` / **8080**（ホスト側3642ではない）です。現Composeの `traefik.enable=false` とDokploy生成ラベルが競合し得るので、そのまま到達すると仮定しません。必要な変更は非公開の配置設定としてレビューし、管理API・metricsを含めて保護します。Domain変更は再デプロイが必要です。

## ベースイメージの確認

Dockerfileの固定FROMと一致する取得コマンド:

```sh
docker pull python:3.12-slim@sha256:05a994d2344eb364cc186910f4fc8786a38215f39f00d0acc25bff33a08f4177
```

これは任意の事前取得です。実際にビルドする同じDockerホスト/builderで行ってください。
別builderのキャッシュには共有されない場合があり、取得済みでもレジストリーのメタデータ・認証確認が不要になる保証はありません。
取得失敗とpip失敗を切り分け、前者はdaemon/builder、後者はbuild argsと証明書・ネットワークを確認します。TLS検証は無効化しません。

## ローカルの使い捨てスモークテスト（運用者が実行）

本番checkout/既存ボリュームでは行わず、新しいcloneで実行します。`docs-smoke-historian` が未使用のComposeプロジェクト名であることとポート空きを先に確認してください。

```sh
python scripts/init_local.py
# 作成した.envのAUTO_STARTを0に変更。必要なら空いているAPP_PORTへ変更する。
docker compose -p docs-smoke-historian config --quiet
docker compose -p docs-smoke-historian build app
docker compose -p docs-smoke-historian up -d --no-build app
curl --fail http://127.0.0.1:3642/healthz
# 管理画面 http://127.0.0.1:3642/ で停止状態・設定・資源ガードを確認する。
docker compose -p docs-smoke-historian down
```

ポートを変更した場合curl/UIの番号も合わせます。`down` はこのプロジェクトのコンテナー等を終了しますがデータボリュームを残します。
使い捨てデータを消す必要があるときだけ、対象が自分の検証用ボリュームであることを確認して別途削除します。`down -v`、全体pruneを安易に実行しません。
ヘルス成功は全プロトコルや継続生成の保証ではありません。HTTP API、設備通信、データ契約の結合試験は別途必要です。

## 検証範囲と参照

この変更にデプロイ用CIは追加しません。Composeの未設定時/ダミープロキシ設定時のrender差分、Git除外、Dockerfile不変を確認します。
実際のビルド、Dokploy配置、認証境界、プロキシ到達性の確認は実行環境で別に行います。render成功だけをビルド成功とは扱いません。

- [Dokploy Docker Compose](https://docs.dokploy.com/docs/core/docker-compose)
- [Dokploy Domains](https://docs.dokploy.com/docs/core/docker-compose/domains)
- [Docker Compose build args](https://docs.docker.com/reference/compose-file/build/#args)
- [Docker predefined proxy arguments](https://docs.docker.com/build/building/variables/#proxy-arguments)
- [Docker daemon proxy](https://docs.docker.com/engine/daemon/proxy/)
