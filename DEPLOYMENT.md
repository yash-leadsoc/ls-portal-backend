# LS Portal – AWS deployment and CI/CD

## Architecture

```
Browser ──HTTPS──> CloudFront ──(OAC)──> S3            (React web app)
Browser ──HTTPS──> api.<your-domain> ──> EC2: Caddy ──> Node API container ──> MongoDB Atlas
                                           │                 └─ Cloudinary, Groq, Google, Web Push
                                           └─ auto Let's Encrypt certificates

GitHub Actions ──OIDC (no stored AWS keys)──> ECR / S3 / SSM / CloudFront
```

- **API**: one EC2 instance (Amazon Linux 2023, t3.small by default) running the backend Docker image plus Caddy for HTTPS. There is no SSH port; access is through SSM Session Manager. Uploads are kept on a Docker volume, logs go to CloudWatch (`/ls-portal/api`), and security updates install automatically.
- **Web app**: private S3 bucket behind CloudFront, with SPA routing, security headers, HTTP/2 and HTTP/3.
- **Secrets**: the backend `.env` lives in SSM Parameter Store as one encrypted SecureString. It is never stored in Git, GitHub or the image.
- **Deploys**: each push to `main` builds, tests and deploys automatically. The backend waits for a health check and rolls back to the previous image if it fails.

Everything below is written for Git Bash on Windows. `MSYS_NO_PATHCONV=1` stops Git Bash from rewriting `/ls-portal/...` into a Windows path.

---

## One-time setup

### 1. Prerequisites

- AWS CLI v2 installed and logged in (`aws sts get-caller-identity` works) with admin rights for the initial setup.
- A domain you control, for the API hostname (e.g. `api.example.com`).
- Region used below: `ap-south-1` (Mumbai). Change it everywhere if you want another region.

### 2. Store the backend secrets in SSM

Set `CORS_ORIGIN` after step 3, once you know the CloudFront URL. For now you can leave it empty.

```bash
cd backend
MSYS_NO_PATHCONV=1 aws ssm put-parameter \
  --region ap-south-1 \
  --name /ls-portal/backend/env \
  --type SecureString \
  --value file://.env \
  --overwrite
```

### 3. Create the infrastructure

```bash
aws cloudformation deploy \
  --region ap-south-1 \
  --stack-name ls-portal \
  --template-file infra/aws-stack.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
      ApiDomain=api.example.com \
      GitHubOrg=yash-leadsoc \
      BackendRepo=LeadSoC-Training-Portal \
      FrontendRepo=LeadSoC-Training-Portal-Frontend \
      DeployBranch=main

aws cloudformation describe-stacks --region ap-south-1 --stack-name ls-portal \
  --query "Stacks[0].Outputs" --output table
```

If the account already has a GitHub OIDC provider, add `CreateGitHubOidcProvider=false`.

### 4. DNS and database access

1. At your DNS provider, create an **A record**: `api.example.com` → the `ElasticIp` output.
2. In MongoDB Atlas, go to **Network Access** and add the `ElasticIp` output.
3. Update `CORS_ORIGIN` in the backend `.env` to the `WebUrl` output (e.g. `https://d123abc.cloudfront.net`), then push it to SSM again with the step 2 command.

### 5. GitHub configuration

In **both** repositories, open **Settings → Environments** and create an environment named `production`. Under **Deployment branches**, allow only `main`.

Then open **Settings → Secrets and variables → Actions → Variables** and add the following (all values come from the stack outputs).

**Backend repo (LeadSoC-Training-Portal)**

| Variable | Value |
|---|---|
| `AWS_REGION` | `ap-south-1` |
| `AWS_BACKEND_ROLE_ARN` | `BackendDeployRoleArn` |
| `ECR_REPOSITORY` | `EcrRepositoryName` |
| `EC2_INSTANCE_ID` | `InstanceId` |
| `ARTIFACT_BUCKET` | `ArtifactBucketName` |
| `API_URL` | `ApiUrl` (e.g. `https://api.example.com/api`) |

**Frontend repo (LeadSoC-Training-Portal-Frontend)**

| Variable | Value |
|---|---|
| `AWS_REGION` | `ap-south-1` |
| `AWS_FRONTEND_ROLE_ARN` | `FrontendDeployRoleArn` |
| `WEB_BUCKET` | `WebBucketName` |
| `CLOUDFRONT_DISTRIBUTION_ID` | `DistributionId` |
| `VITE_API_URL` | `ApiUrl` (e.g. `https://api.example.com/api`) |

No AWS access keys are stored anywhere; GitHub gets short-lived credentials through OIDC.

### 6. Add the pipeline files and deploy

- **Backend repo**: add `.github/workflows/deploy.yml`, `deploy/`, `infra/`, `DEPLOYMENT.md` and the updated `.dockerignore`.
- **Frontend repo**: add `.github/workflows/deploy.yml`.

Merge to `main` and push. Deploy the backend first. Watch progress under the **Actions** tab. The first backend deploy takes a few minutes because Caddy has to obtain the TLS certificate.

---

## Day-to-day

| Task | How |
|---|---|
| Deploy | Push or merge to `main` |
| Re-deploy without changes | Actions → workflow → **Run workflow** |
| Check a PR | PRs run build and tests only, with no deploy |
| Change a secret or env value | Edit `.env`, re-run the step 2 command, then re-run the backend workflow |
| Roll back | Re-run the workflow of an older commit (Actions → that run → **Re-run jobs**) |
| View logs | CloudWatch → Log groups → `/ls-portal/api` (streams `api` and `caddy`) |
| Shell on the server | EC2 console → instance → **Connect → Session Manager**, then `sudo docker ps` |

---

## Cost (approximate, ap-south-1)

| Item | Approx. per month |
|---|---|
| EC2 t3.small | ~$16 |
| EBS 30 GB gp3 | ~$3 |
| Public IPv4 | ~$3.6 |
| CloudFront, S3, ECR, CloudWatch at low traffic | a few dollars |
| **Total** | **~$25/month** |

Check current prices in the AWS Pricing Calculator.

---

## Notes

- **Custom domain for the web app**: request an ACM certificate in `us-east-1`, then add `Aliases` and `ViewerCertificate` to `WebDistribution` in `infra/aws-stack.yml`.
- **Instance size**: large Office-to-PDF conversions are memory-hungry. If uploads fail, change `InstanceType` to `t3.medium` and re-run step 3.
- **Tearing down**: empty both S3 buckets and the ECR repository first, then run `aws cloudformation delete-stack --stack-name ls-portal`.
