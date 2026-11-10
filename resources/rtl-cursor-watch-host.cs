// Windows-subsystem host for rtl-cursor-watch.ps1.
// powershell.exe is a console app: Windows shows its hidden console for ~2s on
// a normal Cursor close (CTRL_CLOSE), but not on End Task. This host has no
// console, so that close flash cannot appear.
//
// csc /nologo /target:winexe /optimize+ /r:"System.Management.Automation.dll" /out:rtl-cursor-watch-host.exe rtl-cursor-watch-host.cs
using System;
using System.IO;
using System.Management.Automation;
using System.Management.Automation.Runspaces;
using System.Threading;

internal static class RtlCursorWatchHost
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args == null || args.Length < 1)
        {
            return 1;
        }

        string scriptPath;
        try
        {
            scriptPath = Path.GetFullPath(args[0]);
        }
        catch
        {
            return 1;
        }

        if (!File.Exists(scriptPath))
        {
            return 1;
        }

        try
        {
            InitialSessionState iss = InitialSessionState.CreateDefault();
            using (Runspace runspace = RunspaceFactory.CreateRunspace(iss))
            {
                runspace.ApartmentState = ApartmentState.STA;
                runspace.Open();
                runspace.SessionStateProxy.SetVariable("PSCommandPath", scriptPath);
                runspace.SessionStateProxy.SetVariable("PSScriptRoot", Path.GetDirectoryName(scriptPath));
                using (PowerShell ps = PowerShell.Create())
                {
                    ps.Runspace = runspace;
                    ps.AddScript(". '" + scriptPath.Replace("'", "''") + "'", false);
                    ps.Invoke();
                }
            }
            return 0;
        }
        catch
        {
            return 2;
        }
    }
}
