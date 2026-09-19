[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("install", "uninstall", "start", "stop", "restart", "status")]
  [string]$Action,

  [string]$NodePath,
  [string]$AgentPath,
  [string]$ConfigPath,
  [string]$ServiceAccount
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ServiceName = "RangeRemoteAgent"
$DisplayName = "Range Remote Agent"
$Description = "Range Remote outbound agent"
$WinSwVersion = "2.12.0"
$WinSwX64Url = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"
$WinSwX64Sha256 = "05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da"
$WinSwX86Url = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x86.exe"
$WinSwX86Sha256 = "0c21327463a43a61f2efb227ec4afd2467fde91618cc725148c1099001ca91ae"

$LocalAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$ServiceDirectory = Join-Path $LocalAppData "Range Remote\service"
$LogDirectory = Join-Path $ServiceDirectory "logs"
$WrapperPath = Join-Path $ServiceDirectory "RangeRemoteAgent.exe"
$WrapperConfigPath = Join-Path $ServiceDirectory "RangeRemoteAgent.xml"
$ScExe = Join-Path $env:SystemRoot "System32\sc.exe"

if ([string]::IsNullOrWhiteSpace($ServiceAccount)) {
  $ServiceAccount = [Security.Principal.WindowsIdentity]::GetCurrent().Name
}

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Quote-ProcessArgument {
  param([Parameter(Mandatory = $true)][string]$Value)
  return '"' + $Value + '"'
}

function Invoke-Elevated {
  $powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $arguments = @(
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    (Quote-ProcessArgument $PSCommandPath),
    "-Action",
    $Action,
    "-ServiceAccount",
    (Quote-ProcessArgument $ServiceAccount)
  )

  if (-not [string]::IsNullOrWhiteSpace($NodePath)) {
    $arguments += @("-NodePath", (Quote-ProcessArgument $NodePath))
  }
  if (-not [string]::IsNullOrWhiteSpace($AgentPath)) {
    $arguments += @("-AgentPath", (Quote-ProcessArgument $AgentPath))
  }
  if (-not [string]::IsNullOrWhiteSpace($ConfigPath)) {
    $arguments += @("-ConfigPath", (Quote-ProcessArgument $ConfigPath))
  }

  try {
    $process = Start-Process -FilePath $powerShell -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  }
  catch {
    throw "Administrator approval is required to manage the Range Remote Windows service. $($_.Exception.Message)"
  }

  exit $process.ExitCode
}

function Get-RangeRemoteService {
  return Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
}

function Escape-Xml {
  param([Parameter(Mandatory = $true)][string]$Value)
  return [Security.SecurityElement]::Escape($Value)
}

function Invoke-Sc {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  & $ScExe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "sc.exe $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

function Ensure-WinSw {
  New-Item -ItemType Directory -Force -Path $ServiceDirectory | Out-Null

  if ([Environment]::Is64BitOperatingSystem) {
    $downloadUrl = $WinSwX64Url
    $expectedHash = $WinSwX64Sha256
  }
  else {
    $downloadUrl = $WinSwX86Url
    $expectedHash = $WinSwX86Sha256
  }

  if (Test-Path -LiteralPath $WrapperPath) {
    $existingHash = (Get-FileHash -LiteralPath $WrapperPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($existingHash -eq $expectedHash) {
      return
    }
    Remove-Item -LiteralPath $WrapperPath -Force
  }

  $temporaryPath = "$WrapperPath.download"
  Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue

  try {
    [Net.ServicePointManager]::SecurityProtocol =
      [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $temporaryPath

    $actualHash = (Get-FileHash -LiteralPath $temporaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
      throw "WinSW SHA-256 mismatch. Expected $expectedHash but received $actualHash."
    }

    Move-Item -LiteralPath $temporaryPath -Destination $WrapperPath -Force
  }
  finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  }
}

function Grant-ServiceLogonRight {
  param([Parameter(Mandatory = $true)][string]$AccountName)

  if (-not ("RangeRemoteLsaRights" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

public static class RangeRemoteLsaRights
{
    private const uint POLICY_CREATE_ACCOUNT = 0x00000010;
    private const uint POLICY_LOOKUP_NAMES = 0x00000800;

    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_OBJECT_ATTRIBUTES
    {
        public uint Length;
        public IntPtr RootDirectory;
        public IntPtr ObjectName;
        public uint Attributes;
        public IntPtr SecurityDescriptor;
        public IntPtr SecurityQualityOfService;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct LSA_UNICODE_STRING
    {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [DllImport("advapi32.dll", PreserveSig = true)]
    private static extern uint LsaOpenPolicy(
        IntPtr SystemName,
        ref LSA_OBJECT_ATTRIBUTES ObjectAttributes,
        uint DesiredAccess,
        out IntPtr PolicyHandle);

    [DllImport("advapi32.dll", PreserveSig = true)]
    private static extern uint LsaAddAccountRights(
        IntPtr PolicyHandle,
        IntPtr AccountSid,
        LSA_UNICODE_STRING[] UserRights,
        uint CountOfRights);

    [DllImport("advapi32.dll", PreserveSig = true)]
    private static extern uint LsaClose(IntPtr ObjectHandle);

    [DllImport("advapi32.dll")]
    private static extern uint LsaNtStatusToWinError(uint Status);

    private static void ThrowOnError(uint status, string operation)
    {
        if (status == 0)
        {
            return;
        }

        uint error = LsaNtStatusToWinError(status);
        throw new Win32Exception((int)error, operation + " failed");
    }

    public static void Grant(string accountName)
    {
        NTAccount account = new NTAccount(accountName);
        SecurityIdentifier sid =
            (SecurityIdentifier)account.Translate(typeof(SecurityIdentifier));
        byte[] sidBytes = new byte[sid.BinaryLength];
        sid.GetBinaryForm(sidBytes, 0);

        IntPtr sidPointer = IntPtr.Zero;
        IntPtr policyHandle = IntPtr.Zero;
        IntPtr rightBuffer = IntPtr.Zero;

        try
        {
            sidPointer = Marshal.AllocHGlobal(sidBytes.Length);
            Marshal.Copy(sidBytes, 0, sidPointer, sidBytes.Length);

            LSA_OBJECT_ATTRIBUTES attributes = new LSA_OBJECT_ATTRIBUTES();
            attributes.Length =
                (uint)Marshal.SizeOf(typeof(LSA_OBJECT_ATTRIBUTES));

            uint status = LsaOpenPolicy(
                IntPtr.Zero,
                ref attributes,
                POLICY_LOOKUP_NAMES | POLICY_CREATE_ACCOUNT,
                out policyHandle);
            ThrowOnError(status, "LsaOpenPolicy");

            const string rightName = "SeServiceLogonRight";
            rightBuffer = Marshal.StringToHGlobalUni(rightName);
            LSA_UNICODE_STRING[] rights = new LSA_UNICODE_STRING[1];
            rights[0].Buffer = rightBuffer;
            rights[0].Length = (ushort)(rightName.Length * 2);
            rights[0].MaximumLength = (ushort)((rightName.Length + 1) * 2);

            status = LsaAddAccountRights(policyHandle, sidPointer, rights, 1);
            ThrowOnError(status, "LsaAddAccountRights");
        }
        finally
        {
            if (rightBuffer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(rightBuffer);
            }
            if (policyHandle != IntPtr.Zero)
            {
                LsaClose(policyHandle);
            }
            if (sidPointer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(sidPointer);
            }
        }
    }
}
"@
  }

  [RangeRemoteLsaRights]::Grant($AccountName)
}

function Write-WrapperConfig {
  if ([string]::IsNullOrWhiteSpace($NodePath) -or
      -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "Node.js executable not found: $NodePath"
  }
  if ([string]::IsNullOrWhiteSpace($AgentPath) -or
      -not (Test-Path -LiteralPath $AgentPath -PathType Leaf)) {
    throw "Built Range Remote agent not found: $AgentPath. Run npm run build first."
  }
  if ([string]::IsNullOrWhiteSpace($ConfigPath) -or
      -not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Range Remote pairing config not found: $ConfigPath. Pair the device before installing the service."
  }

  New-Item -ItemType Directory -Force -Path $ServiceDirectory | Out-Null
  New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

  $distDirectory = Split-Path -Parent $AgentPath
  $repositoryRoot = (Resolve-Path (Join-Path $distDirectory "..\..\..")).Path
  $environmentXml = @()

  foreach ($name in @(
    "USERPROFILE",
    "HOME",
    "APPDATA",
    "LOCALAPPDATA",
    "PATH",
    "TEMP",
    "TMP",
    "SystemRoot",
    "ComSpec"
  )) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      $environmentXml +=
        '  <env name="{0}" value="{1}" />' -f
        (Escape-Xml $name), (Escape-Xml $value)
    }
  }

  $environmentXml +=
    '  <env name="RANGE_REMOTE_CONFIG" value="{0}" />' -f
    (Escape-Xml $ConfigPath)

  $agentArguments = '"' + $AgentPath + '" start'
  $xml = @"
<service>
  <id>$ServiceName</id>
  <name>$DisplayName</name>
  <description>$Description</description>
  <executable>$(Escape-Xml $NodePath)</executable>
  <arguments>$(Escape-Xml $agentArguments)</arguments>
  <workingdirectory>$(Escape-Xml $repositoryRoot)</workingdirectory>
$($environmentXml -join [Environment]::NewLine)
  <stoptimeout>15 sec</stoptimeout>
  <stopparentprocessfirst>true</stopparentprocessfirst>
  <logpath>$(Escape-Xml $LogDirectory)</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>
</service>
"@

  Set-Content -LiteralPath $WrapperConfigPath -Value $xml -Encoding UTF8
}

function Install-RangeRemoteService {
  if (Get-RangeRemoteService) {
    throw "The $DisplayName service is already installed. Run uninstall-service before installing it again."
  }

  Write-WrapperConfig
  Ensure-WinSw
  Grant-ServiceLogonRight -AccountName $ServiceAccount

  Write-Host "Range Remote will run as $ServiceAccount."
  Write-Host "Enter that Windows account's password when prompted. A Windows Hello PIN cannot be used."
  $credential = Get-Credential -UserName $ServiceAccount -Message "Range Remote service account"
  if ($null -eq $credential) {
    throw "Service installation was cancelled before credentials were provided."
  }

  $created = $false
  try {
    $binaryPath = '"' + $WrapperPath + '"'
    $newServiceArguments = @{
      Name = $ServiceName
      BinaryPathName = $binaryPath
      DisplayName = $DisplayName
      Description = $Description
      StartupType = "Automatic"
      Credential = $credential
    }
    New-Service @newServiceArguments | Out-Null
    $created = $true

    Invoke-Sc config $ServiceName "start=" "delayed-auto"
    Invoke-Sc failure $ServiceName "reset=" "3600" "actions=" "restart/5000/restart/15000/restart/60000"
    Invoke-Sc failureflag $ServiceName "1"

    Start-Service -Name $ServiceName
    $service = Get-Service -Name $ServiceName
    $service.WaitForStatus(
      [System.ServiceProcess.ServiceControllerStatus]::Running,
      [TimeSpan]::FromSeconds(30)
    )

    Write-Host "$DisplayName installed and running."
    Write-Host "Startup: Automatic (Delayed Start)"
    Write-Host "Service account: $ServiceAccount"
    Write-Host "WinSW: $WinSwVersion"
    Write-Host "Logs: $LogDirectory"
  }
  catch {
    if ($created) {
      try {
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        Invoke-Sc delete $ServiceName
      }
      catch {
        Write-Warning "The failed installation could not be fully rolled back: $($_.Exception.Message)"
      }
    }
    throw
  }
}

function Uninstall-RangeRemoteService {
  $service = Get-RangeRemoteService
  if ($service) {
    if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
      Stop-Service -Name $ServiceName -Force
      $service.WaitForStatus(
        [System.ServiceProcess.ServiceControllerStatus]::Stopped,
        [TimeSpan]::FromSeconds(30)
      )
    }

    Invoke-Sc delete $ServiceName

    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ((Get-RangeRemoteService) -and [DateTime]::UtcNow -lt $deadline) {
      Start-Sleep -Milliseconds 250
    }

    if (Get-RangeRemoteService) {
      throw "$DisplayName is still pending deletion. Reboot Windows before reinstalling it."
    }
  }

  if (Test-Path -LiteralPath $ServiceDirectory) {
    Remove-Item -LiteralPath $ServiceDirectory -Recurse -Force
  }

  Write-Host "$DisplayName uninstalled. Pairing configuration was left unchanged."
}

function Start-RangeRemoteService {
  $service = Get-RangeRemoteService
  if (-not $service) {
    throw "$DisplayName is not installed."
  }

  if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Running) {
    Start-Service -Name $ServiceName
    $service.WaitForStatus(
      [System.ServiceProcess.ServiceControllerStatus]::Running,
      [TimeSpan]::FromSeconds(30)
    )
  }

  Write-Host "$DisplayName is running."
}

function Stop-RangeRemoteService {
  $service = Get-RangeRemoteService
  if (-not $service) {
    throw "$DisplayName is not installed."
  }

  if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
    Stop-Service -Name $ServiceName
    $service.WaitForStatus(
      [System.ServiceProcess.ServiceControllerStatus]::Stopped,
      [TimeSpan]::FromSeconds(30)
    )
  }

  Write-Host "$DisplayName is stopped."
}

function Restart-RangeRemoteService {
  $service = Get-RangeRemoteService
  if (-not $service) {
    throw "$DisplayName is not installed."
  }

  if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
    Stop-Service -Name $ServiceName
    $service.WaitForStatus(
      [System.ServiceProcess.ServiceControllerStatus]::Stopped,
      [TimeSpan]::FromSeconds(30)
    )
  }

  Start-Service -Name $ServiceName
  $service = Get-Service -Name $ServiceName
  $service.WaitForStatus(
    [System.ServiceProcess.ServiceControllerStatus]::Running,
    [TimeSpan]::FromSeconds(30)
  )

  Write-Host "$DisplayName restarted."
}

function Show-RangeRemoteServiceStatus {
  $service = Get-RangeRemoteService
  if (-not $service) {
    Write-Host "$DisplayName is not installed."
    return
  }

  $details = Get-CimInstance -ClassName Win32_Service -Filter "Name='$ServiceName'"
  [PSCustomObject]@{
    Name = $details.Name
    DisplayName = $details.DisplayName
    State = $details.State
    StartMode = $details.StartMode
    ServiceAccount = $details.StartName
    ProcessId = $details.ProcessId
    Wrapper = $WrapperPath
    Config = $WrapperConfigPath
    Logs = $LogDirectory
  } | Format-List
}

if ($Action -ne "status" -and -not (Test-Administrator)) {
  Invoke-Elevated
}

switch ($Action) {
  "install" { Install-RangeRemoteService }
  "uninstall" { Uninstall-RangeRemoteService }
  "start" { Start-RangeRemoteService }
  "stop" { Stop-RangeRemoteService }
  "restart" { Restart-RangeRemoteService }
  "status" { Show-RangeRemoteServiceStatus }
}
