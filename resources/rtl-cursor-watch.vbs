' Hidden launcher for rtl-cursor-watch-host.exe.
' The host is a Windows-subsystem process, so it has no console. powershell.exe
' is a console app: Windows shows that hidden console for ~2s on a normal
' Cursor close (CTRL_CLOSE), but not on End Task.
Option Explicit
Dim sh, fso, dir, ps1, host, lockPath, held
Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = dir & "\rtl-cursor-watch.ps1"
host = dir & "\rtl-cursor-watch-host.exe"
If Not fso.FileExists(ps1) Then
  WScript.Quit 1
End If
RemoveOldWatchTask
' Registry writes and the running-watcher check stay inside this windowless
' script so logon and Cursor starts do not flash a console.
sh.RegWrite "HKCU\Software\Microsoft\Windows\CurrentVersion\Run\RtlCursorWatch", "wscript.exe //nologo //B """ & WScript.ScriptFullName & """", "REG_SZ"
lockPath = dir & "\watch.lock"
If fso.FileExists(lockPath) Then
  On Error Resume Next
  Set held = fso.OpenTextFile(lockPath, 1, False)
  If Err.Number <> 0 Then
    WScript.Quit 0
  End If
  held.Close
  On Error GoTo 0
End If
If WatcherAlreadyRunning(ps1) Then
  WScript.Quit 0
End If
If fso.FileExists(host) Then
  If StartWatcherHost(host, ps1) Then
    WScript.Quit 0
  End If
End If
If StartWatcherViaWmi(ps1) Then
  WScript.Quit 0
End If
WScript.Quit 1

Function RemoveOldWatchTask()
  Dim service, root
  On Error Resume Next
  Set service = CreateObject("Schedule.Service")
  If Err.Number <> 0 Then
    Err.Clear
    Exit Function
  End If
  service.Connect()
  If Err.Number <> 0 Then
    Err.Clear
    Exit Function
  End If
  Set root = service.GetFolder("\")
  root.DeleteTask "RtlCursorWatch", 0
  Err.Clear
End Function

Function StartWatcherHost(hostPath, ps1Path)
  Dim startup, proc, pid, result, cmd
  StartWatcherHost = False
  cmd = """" & hostPath & """ """ & ps1Path & """"
  On Error Resume Next
  Set startup = GetObject("winmgmts:Win32_ProcessStartup").SpawnInstance_
  If Err.Number <> 0 Then
    Err.Clear
    StartWatcherHost = StartWatcherHostShell(hostPath, ps1Path)
    Exit Function
  End If
  startup.ShowWindow = 0
  ' CREATE_BREAKAWAY_FROM_JOB keeps the helper out of Cursor's process job.
  startup.CreateFlags = 16777216
  Err.Clear
  Set proc = GetObject("winmgmts:Win32_Process")
  result = proc.Create(cmd, Null, startup, pid)
  If result = 0 And Err.Number = 0 Then
    StartWatcherHost = True
    Exit Function
  End If
  Err.Clear
  startup.CreateFlags = 0
  result = proc.Create(cmd, Null, startup, pid)
  If result = 0 And Err.Number = 0 Then
    StartWatcherHost = True
    Exit Function
  End If
  Err.Clear
  StartWatcherHost = StartWatcherHostShell(hostPath, ps1Path)
End Function

Function StartWatcherHostShell(hostPath, ps1Path)
  Dim app
  StartWatcherHostShell = False
  On Error Resume Next
  Set app = CreateObject("Shell.Application")
  If Err.Number <> 0 Then
    Err.Clear
    Exit Function
  End If
  app.ShellExecute hostPath, """" & ps1Path & """", fso.GetParentFolderName(hostPath), "open", 0
  If Err.Number = 0 Then
    StartWatcherHostShell = True
  End If
End Function

Function StartWatcherViaWmi(ps1Path)
  Dim startup, proc, pid, result, cmd
  StartWatcherViaWmi = False
  cmd = "powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & ps1Path & """"
  On Error Resume Next
  Set startup = GetObject("winmgmts:Win32_ProcessStartup").SpawnInstance_
  If Err.Number <> 0 Then
    Err.Clear
    Exit Function
  End If
  startup.ShowWindow = 0
  Set proc = GetObject("winmgmts:Win32_Process")
  Err.Clear
  result = proc.Create(cmd, Null, startup, pid)
  If result = 0 And Err.Number = 0 Then
    StartWatcherViaWmi = True
  End If
End Function

Function WatcherAlreadyRunning(scriptPath)
  Dim loc, procs, proc, name
  WatcherAlreadyRunning = False
  On Error Resume Next
  Set loc = GetObject("winmgmts:\\.\root\cimv2")
  If Err.Number <> 0 Then
    Err.Clear
    Exit Function
  End If
  Set procs = loc.ExecQuery("SELECT Name, CommandLine FROM Win32_Process")
  For Each proc In procs
    If InStr(1, proc.CommandLine, scriptPath, vbTextCompare) > 0 Then
      name = LCase(proc.Name)
      If name = "powershell.exe" Or name = "rtl-cursor-watch-host.exe" Then
        WatcherAlreadyRunning = True
        Exit Function
      End If
    End If
  Next
End Function
