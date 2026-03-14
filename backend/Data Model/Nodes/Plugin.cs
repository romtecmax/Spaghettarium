using System;

namespace ShapeDiver.GraphDb;

/// <summary>
/// A plugin, identified by its <see cref="PluginId"/>.
/// </summary>
public struct Plugin
{
    /// <summary>
    /// The id of the plugin.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_GH_AssemblyInfo_Id.htm
    /// </summary>
    [DbEqualityCheck]
    public Guid PluginId;

    /// <summary>
    /// The name of the plugin.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_GH_AssemblyInfo_Name.htm
    /// </summary>
    [DbSerialize]
    public string Name;

    /// <summary>
    /// The author of the plugin.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_GH_AssemblyInfo_AuthorName.htm
    /// </summary>
    [DbSerialize]
    public string Author;
}