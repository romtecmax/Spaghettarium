using System;

namespace ShapeDiver.GraphDb;

/// <summary>
/// An instance of a component in a document, uniquely identified by its 
/// <see cref="InstanceGuid"> and <see cref="VersionId">version</see>.
/// </summary>
public struct ComponentInstance
{
    /// <summary>
    /// Unique id of the component's instance in the document.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_GH_InstanceDescription_InstanceGuid.htm
    /// </summary>
    [DbEqualityCheck]
    public Guid InstanceGuid;

    /// <summary>
    /// Unique identifier for the version of the Grasshopper document.
    /// </summary>
    [DbEqualityCheck]
    public Guid VersionId;

    /// <summary>
    /// Unique id of the component type.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_GH_DocumentObject_ComponentGuid.htm
    /// </summary>
    [DbSerialize]
    public Guid ComponentGuid;

    /// <summary>
    /// Name of the component instance.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_GH_InstanceDescription_Name.htm
    /// </summary>
    [DbSerialize]
    public string InstanceName;

    /// <summary>
    /// Name of the component type.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_GH_InstanceDescription_Name.htm
    /// </summary>
    [DbSerialize]
    public string ComponentName;

    /// <summary>
    /// If this component is a cluster, this refers to the <see cref="DocumentVersion.VersionId"/>
    /// of the corresponding cluster document.
    /// </summary>
    [DbSerialize]
    public Guid? ClusterId;

    /// <summary>
    /// Pivot point of the component instance, X-coordinate.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_IGH_Attributes_Pivot.htm
    /// </summary>
    [DbSerialize]
    public float? PivotX;

    /// <summary>
    /// Pivot point of the component instance, Y-coordinate.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_IGH_Attributes_Pivot.htm
    /// </summary>
    [DbSerialize]
    public float? PivotY;

}