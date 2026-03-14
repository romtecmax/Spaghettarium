using System;

namespace ShapeDiver.GraphDb;

/// <summary>
/// A plugin version, uniquely identified by its <see cref="PluginId"> and <see cref="Version"/>.
/// </summary>
public struct PluginVersion
{
    /// <summary>
    /// The id of the plugin.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_GH_AssemblyInfo_Id.htm
    /// </summary>
    [DbEqualityCheck]
    public Guid PluginId;

    /// <summary>
    /// The version of the plugin.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_GH_AssemblyInfo_Version.htm
    /// </summary>
    [DbEqualityCheck]
    public string Version;

    /// <summary>
    /// The name of the plugin version.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_GH_AssemblyInfo_Name.htm
    /// </summary>
    [DbSerialize]
    public string Name;

    /// <summary>
    /// The author of the plugin version.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_GH_AssemblyInfo_AuthorName.htm
    /// </summary>
    [DbSerialize]
    public string Author;

    /// <summary>
    /// The assembly version of the plugin.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_GH_AssemblyInfo_Assembly.htm
    /// </summary>
    [DbEqualityCheck]
    public string AssemblyVersion;

    /// <summary>
    /// The assembly name of the plugin version.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_GH_AssemblyInfo_Assembly.htm
    /// </summary>
    [DbSerialize]
    public string AssemblyName;
}