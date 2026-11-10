' Hidden launcher for rtl-cursor-watch.ps1.
' conhost --headless keeps Windows Terminal from opening a window.
' WScript.Shell.Run style 0 is not enough when Terminal is the default host.
Option Explicit
Dim sh, fso, dir, ps1, cmd, lockPath, held
Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = dir & "\rtl-cursor-watch.ps1"
If Not fso.FileExists(ps1) Then
  WScript.Quit 1
End If
' Registry writes and the running-watcher check stay inside this windowless
' script. powershell.exe and reg.exe are console programs and open a window.
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
cmd = "conhost.exe --headless powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & ps1 & """"
sh.Run cmd, 0, False

Function WatcherAlreadyRunning(scriptPath)
  Dim loc, procs, proc
  WatcherAlreadyRunning = False
  On Error Resume Next
  Set loc = GetObject("winmgmts:\\.\root\cimv2")
  If Err.Number <> 0 Then
    Err.Clear
    Exit Function
  End If
  Set procs = loc.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name = 'powershell.exe'")
  For Each proc In procs
    If InStr(1, proc.CommandLine, scriptPath, vbTextCompare) > 0 Then
      WatcherAlreadyRunning = True
      Exit Function
    End If
  Next
End Function
